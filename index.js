class FlightSimulator {
    constructor() {
        this.map = null;
        this.plane = document.getElementById('plane');
        
        // Start in Singapore airspace
        this.currentPosition = { lat: 1.3521, lng: 103.8198 }; // Singapore center
        this.heading = 0;
        this.altitude = 10000;
        this.speed = 450;
        this.zoom = 12;
        
        // Singapore and regional targets for radar detection
        this.targets = [
            { lat: 1.3521, lng: 103.8198, name: "Singapore City" },
            { lat: 1.3644, lng: 103.9915, name: "Changi Airport" },
            { lat: 1.2966, lng: 103.7764, name: "Jurong Island" },
            { lat: 1.4382, lng: 103.7890, name: "Woodlands" },
            { lat: 1.3302, lng: 103.7340, name: "Tuas" },
            { lat: 1.3483, lng: 103.9565, name: "Pasir Ris" },
            { lat: 1.4504, lng: 103.8235, name: "Sembawang" },
            // Regional targets
            { lat: 3.1390, lng: 101.6869, name: "Kuala Lumpur" },
            { lat: 5.4164, lng: 100.3327, name: "Penang" },
            { lat: -6.2088, lng: 106.8456, name: "Jakarta" },
            { lat: 13.7563, lng: 100.5018, name: "Bangkok" },
            { lat: 14.5995, lng: 120.9842, name: "Manila" }
        ];
        
        this.radarRange = 200; // km (reduced for Singapore region)
        this.keys = {};
        this.audioContext = null;
        this.engineSound = null;
        this.beepSound = null;
        this.lastBeepTime = 0;
        
        this.init();
    }

    async init() {
        await this.initAudio();
        this.setupEventListeners();
        this.showLoadingScreen();
    }

    showLoadingScreen() {
        const progress = document.getElementById('loadingProgress');
        let width = 0;
        const interval = setInterval(() => {
            width += Math.random() * 12 + 3;
            if (width >= 100) {
                width = 100;
                clearInterval(interval);
                setTimeout(() => {
                    document.getElementById('loadingScreen').style.display = 'none';
                    document.getElementById('gameContainer').style.display = 'block';
                    this.startGame();
                }, 1);
            }
            progress.style.width = width + '%';
        }, 1);
    }

    async initAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            // Create engine sound (continuous low frequency)
            this.engineSound = this.createEngineSound();
            // Create beep sound function
            this.beepSound = this.createBeepSound();
        } catch (e) {
            console.log('Audio initialization failed:', e);
        }
    }

    createEngineSound() {
        if (!this.audioContext) return null;
        
        try {
            const oscillator = this.audioContext.createOscillator();
            const gainNode = this.audioContext.createGain();
            const filter = this.audioContext.createBiquadFilter();
            
            oscillator.type = 'sawtooth';
            oscillator.frequency.setValueAtTime(85, this.audioContext.currentTime);
            
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(180, this.audioContext.currentTime);
            
            gainNode.gain.setValueAtTime(0.08, this.audioContext.currentTime);
            
            oscillator.connect(filter);
            filter.connect(gainNode);
            gainNode.connect(this.audioContext.destination);
            
            return { oscillator, gainNode, filter };
        } catch (e) {
            console.log('Engine sound creation failed:', e);
            return null;
        }
    }

    createBeepSound() {
        if (!this.audioContext) return null;
        
        return () => {
            try {
                const now = this.audioContext.currentTime;
                if (now - this.lastBeepTime < 0.5) return; // Prevent spam
                this.lastBeepTime = now;
                
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(1200, now);
                
                gainNode.gain.setValueAtTime(0, now);
                gainNode.gain.linearRampToValueAtTime(0.2, now + 0.01);
                gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
                
                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                
                oscillator.start(now);
                oscillator.stop(now + 0.15);
            } catch (e) {
                console.log('Beep sound failed:', e);
            }
        };
    }

    setupEventListeners() {
        // Keyboard controls
        document.addEventListener('keydown', (e) => {
            this.keys[e.code] = true;
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // Mouse wheel for altitude control
        document.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.zoom = Math.min(18, this.zoom + 0.5);
                this.altitude = Math.min(50000, this.altitude + 1000);
            } else {
                this.zoom = Math.max(8, this.zoom - 0.5);
                this.altitude = Math.max(1000, this.altitude - 1000);
            }
            
            if (this.map) {
                this.map.setZoom(this.zoom);
            }
            
            this.updatePlaneSize();
            this.updateSpeedEffects();
        }, { passive: false });

        // Click to start audio
        document.addEventListener('click', () => {
            if (this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume();
            }
        });
    }

    startGame() {
        this.initMap();
        this.startEngineSound();
        this.gameLoop();
    }

    initMap() {
        // Initialize Leaflet map with OpenStreetMap
        this.map = L.map('map', {
            center: [this.currentPosition.lat, this.currentPosition.lng],
            zoom: this.zoom,
            zoomControl: true,
            attributionControl: false
        });

        // Add OpenStreetMap satellite-like tiles
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 18,
            attribution: '&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
        }).addTo(this.map);

        // Disable map interactions to prevent interference with game controls
        this.map.dragging.disable();
        this.map.touchZoom.disable();
        this.map.doubleClickZoom.disable();
        this.map.scrollWheelZoom.disable();
        this.map.boxZoom.disable();
        this.map.keyboard.disable();
    }

    startEngineSound() {
        if (this.engineSound && this.engineSound.oscillator) {
            try {
                this.engineSound.oscillator.start();
            } catch (e) {
                console.log('Engine sound start failed:', e);
            }
        }
    }

    updatePlaneSize() {
        const baseScale = Math.max(0.6, Math.min(2.5, this.zoom / 12));
        const altitudeScale = Math.max(0.8, Math.min(1.5, this.altitude / 15000));
        const finalScale = baseScale * altitudeScale;
        
        this.plane.style.transform = `translate(-50%, -50%) rotate(${this.heading}deg) scale(${finalScale})`;
    }

    updateSpeedEffects() {
        const body = document.body;
        body.classList.remove('high-speed', 'supersonic');
        
        if (this.speed > 600) {
            body.classList.add('high-speed');
        }
        if (this.speed > 800) {
            body.classList.add('supersonic');
        }
        
        // Update engine sound based on speed
        if (this.engineSound && this.engineSound.filter) {
            const frequency = 150 + (this.speed - 400) * 0.3;
            this.engineSound.filter.frequency.setValueAtTime(
                Math.max(120, Math.min(400, frequency)), 
                this.audioContext.currentTime
            );
        }
    }

    handleControls() {
        let moved = false;
        const baseSpeed = 0.0008; // Base movement speed
        const speedMultiplier = this.speed / 450; // Speed affects movement
        const moveSpeed = baseSpeed * speedMultiplier;

        // Calculate movement based on heading
        const headingRad = (this.heading - 90) * Math.PI / 180; // -90 to align with "up" being north

        if (this.keys['ArrowUp'] || this.keys['KeyW']) {
            this.currentPosition.lat += moveSpeed * Math.sin(headingRad);
            this.currentPosition.lng += moveSpeed * Math.cos(headingRad);
            this.speed = Math.min(900, this.speed + 2);
            moved = true;
        }
        
        if (this.keys['ArrowDown'] || this.keys['KeyS']) {
            this.currentPosition.lat -= moveSpeed * Math.sin(headingRad) * 0.7;
            this.currentPosition.lng -= moveSpeed * Math.cos(headingRad) * 0.7;
            this.speed = Math.max(200, this.speed - 3);
            moved = true;
        }
        
        if (this.keys['ArrowLeft'] || this.keys['KeyA']) {
            this.heading -= 2.5;
            if (this.heading < 0) this.heading += 360;
        }
        
        if (this.keys['ArrowRight'] || this.keys['KeyD']) {
            this.heading += 2.5;
            if (this.heading >= 360) this.heading -= 360;
        }

        // Gradual speed decay when not accelerating
        if (!moved) {
            this.speed = Math.max(300, this.speed - 1);
        }

        // World wrapping
        if (this.currentPosition.lng > 180) this.currentPosition.lng -= 360;
        if (this.currentPosition.lng < -180) this.currentPosition.lng += 360;
        if (this.currentPosition.lat > 85) this.currentPosition.lat = 85;
        if (this.currentPosition.lat < -85) this.currentPosition.lat = -85;

        // Update map center
        if (moved && this.map) {
            this.map.setView([this.currentPosition.lat, this.currentPosition.lng], this.zoom);
        }

        this.updatePlaneSize();
        this.updateSpeedEffects();
    }

    updateHUD() {
        document.getElementById('altitude').textContent = `ALT: ${this.altitude.toLocaleString()} ft`;
        document.getElementById('speed').textContent = `SPD: ${Math.round(this.speed)} kts`;
        document.getElementById('coordinates').innerHTML = 
            `LAT: ${this.currentPosition.lat.toFixed(4)}°<br>LNG: ${this.currentPosition.lng.toFixed(4)}°`;
        document.getElementById('heading').textContent = `HDG: ${Math.round(this.heading).toString().padStart(3, '0')}°`;
    }

    updateRadar() {
        // Clear existing dots
        const existingDots = document.querySelectorAll('.radar-dot');
        existingDots.forEach(dot => dot.remove());

        const radar = document.getElementById('radar');
        
        this.targets.forEach(target => {
            const distance = this.calculateDistance(this.currentPosition, target);
            
            if (distance <= this.radarRange) {
                // Calculate relative position on radar
                const bearing = this.calculateBearing(this.currentPosition, target);
                const relativeBearing = (bearing - this.heading + 360) % 360;
                const radarDistance = (distance / this.radarRange) * 90; // 90px radius
                
                const x = Math.sin(relativeBearing * Math.PI / 180) * radarDistance + 100;
                const y = 100 - Math.cos(relativeBearing * Math.PI / 180) * radarDistance;
                
                const dot = document.createElement('div');
                dot.className = 'radar-dot';
                dot.style.left = x + 'px';
                dot.style.top = y + 'px';
                dot.title = `${target.name} - ${Math.round(distance)}km`;
                radar.appendChild(dot);
                
                // Play beep sound for close targets
                if (this.beepSound && distance <= this.radarRange / 3) {
                    this.beepSound();
                }
            }
        });
    }

    calculateDistance(pos1, pos2) {
        const R = 6371; // Earth's radius in km
        const dLat = (pos2.lat - pos1.lat) * Math.PI / 180;
        const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + 
                 Math.cos(pos1.lat * Math.PI / 180) * 
                 Math.cos(pos2.lat * Math.PI / 180) * 
                 Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    calculateBearing(pos1, pos2) {
        const dLng = (pos2.lng - pos1.lng) * Math.PI / 180;
        const lat1 = pos1.lat * Math.PI / 180;
        const lat2 = pos2.lat * Math.PI / 180;
        const y = Math.sin(dLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - 
                 Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    gameLoop() {
        this.handleControls();
        this.updateHUD();
        this.updateRadar();
        
        requestAnimationFrame(() => this.gameLoop());
    }
}

// Initialize the flight simulator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new FlightSimulator();
});

// Additional keyboard shortcuts
document.addEventListener('keydown', (e) => {
    switch(e.code) {
        case 'KeyR':
            // Reset position to Singapore
            if (window.flightSim) {
                window.flightSim.currentPosition = { lat: 1.3521, lng: 103.8198 };
                window.flightSim.heading = 0;
                window.flightSim.speed = 450;
                window.flightSim.altitude = 10000;
                if (window.flightSim.map) {
                    window.flightSim.map.setView([1.3521, 103.8198], 12);
                }
            }
            break;
        case 'KeyF':
            // Toggle fullscreen
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
            break;
        case 'KeyM':
            // Mute/unmute audio
            if (window.flightSim && window.flightSim.engineSound) {
                const gain = window.flightSim.engineSound.gainNode;
                if (gain.gain.value > 0) {
                    gain.gain.setValueAtTime(0, window.flightSim.audioContext.currentTime);
                } else {
                    gain.gain.setValueAtTime(0.08, window.flightSim.audioContext.currentTime);
                }
            }
            break;
    }
});

// Store reference globally for keyboard shortcuts
window.addEventListener('load', () => {
    setTimeout(() => {
        if (window.flightSimulator) {
            window.flightSim = window.flightSimulator;
        }
    }, 2000);
});