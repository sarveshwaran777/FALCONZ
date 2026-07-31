/**
 * Advanced Canvas Primary Flight Display (PFD) Renderer
 * Styled like Mission Planner / ArduPilot / Garmin G1000 HUD.
 * Features:
 * - Top Compass Heading Tape (with cardinal directions N, S, E, W, etc.)
 * - Left Airspeed Tape with pointer tag
 * - Right Altitude Tape with pointer tag & climb indicator
 * - Dynamic Artificial Horizon (Sky Gradient, Olive Grass Ground, Pitch Ladder)
 * - Top Roll Arc with degree numbers (60, 45, 30, 20, 10, 0, ...) & red roll pointer
 * - Red Chevron Aircraft Symbol (- - ∧ - -)
 * - Live HUD Telemetry Text Overlays (Airspeed, Groundspeed, Battery, Clock, Armed/Safe, Mode, GPS Fix)
 */
class AttitudeIndicator {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) return;
        this.ctx = this.canvas.getContext('2d');
        
        // Telemetry State (Current interpolated values)
        this.roll = 0;         // deg
        this.pitch = 0;        // deg
        this.heading = 0;      // deg
        this.airspeed = 0;     // m/s
        this.groundspeed = 0;  // m/s
        this.altitude = 0;     // m
        this.climb = 0;        // m/s

        // Target Telemetry State (Incoming raw WebSocket targets for smooth lerp)
        this.targetRoll = 0;
        this.targetPitch = 0;
        this.targetHeading = 0;
        this.targetAirspeed = 0;
        this.targetGroundspeed = 0;
        this.targetAltitude = 0;
        this.targetClimb = 0;

        // Instant Text Fields
        this.voltage = 0;      // V
        this.current = 0;      // A
        this.remaining = 0;    // %
        this.armed = false;
        this.mode = 'STANDBY';
        this.gpsFix = 'NO FIX';
        this.connected = false;

        this.animating = false;
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.startLoop();
    }

    resize() {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const dpr = window.devicePixelRatio || 1;
            const newW = Math.round(rect.width * dpr);
            const newH = Math.round(rect.height * dpr);
            if (this.canvas.width !== newW || this.canvas.height !== newH) {
                this.canvas.width = newW;
                this.canvas.height = newH;
                this.needsRedraw = true;
            }
        }
        this.draw();
    }

    forceRedraw() {
        this.needsRedraw = true;
        this.resize();
        this.draw();
    }

    startLoop() {
        if (this.animating) return;
        this.animating = true;
        const loop = () => {
            if (!this.animating) return;
            if (this.canvas && this.canvas.offsetParent !== null) {
                if (this.canvas.width === 0 || this.canvas.height === 0) {
                    this.resize();
                }
                const moved = this.stepInterpolation();
                if (moved || this.needsRedraw || !this.initialDrawDone) {
                    this.initialDrawDone = true;
                    this.needsRedraw = false;
                    this.draw();
                }
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    stepInterpolation() {
        let moved = false;
        const lerp = (current, target, factor = 0.25) => {
            const diff = target - current;
            if (Math.abs(diff) < 0.001) return target;
            moved = true;
            return current + diff * factor;
        };

        // Smooth shortest angular distance for heading lerp
        let hdgDiff = (this.targetHeading - this.heading + 540) % 360 - 180;
        if (Math.abs(hdgDiff) > 0.01) {
            moved = true;
            this.heading = (this.heading + hdgDiff * 0.25 + 360) % 360;
        }

        this.roll = lerp(this.roll, this.targetRoll, 0.25);
        this.pitch = lerp(this.pitch, this.targetPitch, 0.25);
        this.airspeed = lerp(this.airspeed, this.targetAirspeed, 0.2);
        this.groundspeed = lerp(this.groundspeed, this.targetGroundspeed, 0.2);
        this.altitude = lerp(this.altitude, this.targetAltitude, 0.2);
        this.climb = lerp(this.climb, this.targetClimb, 0.2);
        return moved;
    }

    update(roll, pitch, opts = {}) {
        this.needsRedraw = true;
        this.targetRoll = (roll !== null && roll !== undefined) ? roll : 0;
        this.targetPitch = (pitch !== null && pitch !== undefined) ? pitch : 0;

        if (typeof opts === 'object' && opts !== null) {
            if (opts.heading !== undefined) this.targetHeading = opts.heading || 0;
            if (opts.airspeed !== undefined) this.targetAirspeed = opts.airspeed || 0;
            if (opts.groundspeed !== undefined) this.targetGroundspeed = opts.groundspeed || 0;
            if (opts.altitude !== undefined) this.targetAltitude = opts.altitude || 0;
            if (opts.climb !== undefined) this.targetClimb = opts.climb || 0;
            if (opts.voltage !== undefined) this.voltage = opts.voltage || 0;
            if (opts.current !== undefined) this.current = opts.current || 0;
            if (opts.remaining !== undefined) this.remaining = opts.remaining || 0;
            if (opts.armed !== undefined) this.armed = Boolean(opts.armed);
            if (opts.mode !== undefined) this.mode = opts.mode || 'STANDBY';
            if (opts.gpsFix !== undefined) this.gpsFix = opts.gpsFix || 'NO FIX';
            if (opts.connected !== undefined) this.connected = Boolean(opts.connected);
        }
    }

    draw() {
        if (!this.canvas || !this.ctx) return;
        const ctx = this.ctx;
        const w = this.canvas.width;
        const h = this.canvas.height;
        const cx = w / 2;
        const cy = h / 2;
        const refSize = Math.min(w, h);
        const diag = Math.sqrt(w * w + h * h) * 2;

        ctx.save();
        ctx.clearRect(0, 0, w, h);

        // ==========================================
        // 1. ROTATING & TRANSLATING ARTIFICIAL HORIZON
        // ==========================================
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((-this.roll * Math.PI) / 180);

        // Pitch displacement: 1 deg = refSize / 45 pixels
        const pixelsPerDeg = refSize / 45;
        const pitchY = this.pitch * pixelsPerDeg;

        // Sky & Ground Rectangles
        // Sky: Vibrant Sky Blue Gradient
        const skyGrad = ctx.createLinearGradient(0, -diag, 0, pitchY);
        skyGrad.addColorStop(0, '#1d4ed8');
        skyGrad.addColorStop(1, '#38bdf8');
        ctx.fillStyle = skyGrad;
        ctx.fillRect(-diag, -diag * 2 + pitchY, diag * 2, diag * 2);

        // Ground: Warm Grass/Olive Green (Matches Mission Planner PFD)
        const groundGrad = ctx.createLinearGradient(0, pitchY, 0, diag);
        groundGrad.addColorStop(0, '#65a30d');
        groundGrad.addColorStop(1, '#3f6212');
        ctx.fillStyle = groundGrad;
        ctx.fillRect(-diag, pitchY, diag * 2, diag * 2);

        // Horizon Line (Green Accent Line)
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-diag, pitchY);
        ctx.lineTo(diag, pitchY);
        ctx.stroke();

        // Pitch Ladder Lines (-60 to +60 deg)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 ${Math.round(refSize * 0.055)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 2;

        const ladderW = refSize * 0.35;

        for (let p = -60; p <= 60; p += 10) {
            if (p === 0) continue;
            const y = pitchY - (p * pixelsPerDeg);
            const lineW = (p % 20 === 0) ? ladderW : ladderW * 0.6;

            ctx.beginPath();
            if (p > 0) {
                // Positive pitch: solid lines with downward ticks at ends
                ctx.moveTo(-lineW / 2, y);
                ctx.lineTo(lineW / 2, y);
                ctx.moveTo(-lineW / 2, y);
                ctx.lineTo(-lineW / 2, y + 6);
                ctx.moveTo(lineW / 2, y);
                ctx.lineTo(lineW / 2, y + 6);
            } else {
                // Negative pitch: dashed lines with upward ticks at ends
                ctx.setLineDash([5, 4]);
                ctx.moveTo(-lineW / 2, y);
                ctx.lineTo(lineW / 2, y);
                ctx.setLineDash([]);
                ctx.moveTo(-lineW / 2, y);
                ctx.lineTo(-lineW / 2, y - 6);
                ctx.moveTo(lineW / 2, y);
                ctx.lineTo(lineW / 2, y - 6);
            }
            ctx.stroke();

            // Pitch degree labels
            if (p % 10 === 0) {
                ctx.fillText(Math.abs(p).toString(), -lineW / 2 - 14, y);
                ctx.fillText(Math.abs(p).toString(), lineW / 2 + 14, y);
            }
        }
        ctx.restore(); // Restore from pitch/roll rotation

        // ==========================================
        // 2. FIXED AIRCRAFT SYMBOL (RED CHEVRON & WINGS)
        // ==========================================
        ctx.save();
        ctx.strokeStyle = '#ef4444'; // Bright Red
        ctx.fillStyle = '#ef4444';
        ctx.lineWidth = 4;

        // Left Wing Bar
        ctx.beginPath();
        ctx.moveTo(cx - refSize * 0.3, cy);
        ctx.lineTo(cx - refSize * 0.12, cy);
        ctx.stroke();

        // Right Wing Bar
        ctx.beginPath();
        ctx.moveTo(cx + refSize * 0.12, cy);
        ctx.lineTo(cx + refSize * 0.3, cy);
        ctx.stroke();

        // Center Chevron ∧
        const chevW = refSize * 0.1;
        const chevH = refSize * 0.08;
        ctx.beginPath();
        ctx.moveTo(cx - chevW, cy + chevH / 2);
        ctx.lineTo(cx, cy - chevH / 2);
        ctx.lineTo(cx + chevW, cy + chevH / 2);
        ctx.stroke();
        ctx.restore();

        // ==========================================
        // 3. ROLL ARC AT TOP WITH DEGREE NUMBERS
        // ==========================================
        ctx.save();
        const rollRadius = refSize * 0.36;
        const rollCenterY = cy - refSize * 0.02;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, rollCenterY, rollRadius, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();

        // Roll ticks & labels: 60, 45, 30, 20, 10, 0, 10, 20, 30, 45, 60
        const rollTicks = [
            { deg: -60, label: '60' },
            { deg: -45, label: '45' },
            { deg: -30, label: '30' },
            { deg: -20, label: '20' },
            { deg: -10, label: '10' },
            { deg: 0, label: '0' },
            { deg: 10, label: '10' },
            { deg: 20, label: '20' },
            { deg: 30, label: '30' },
            { deg: 45, label: '45' },
            { deg: 60, label: '60' }
        ];

        ctx.font = `600 ${Math.round(refSize * 0.04)}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        rollTicks.forEach(t => {
            const rad = ((t.deg - 90) * Math.PI) / 180;
            const r1 = rollRadius;
            const r2 = (t.deg % 30 === 0 || t.deg === 0) ? rollRadius - 10 : rollRadius - 6;

            ctx.beginPath();
            ctx.moveTo(cx + r1 * Math.cos(rad), rollCenterY + r1 * Math.sin(rad));
            ctx.lineTo(cx + r2 * Math.cos(rad), rollCenterY + r2 * Math.sin(rad));
            ctx.stroke();

            // Label position slightly outside arc
            const rText = rollRadius + 11;
            const tx = cx + rText * Math.cos(rad);
            const ty = rollCenterY + rText * Math.sin(rad);

            // Rotate text to follow curvature
            ctx.save();
            ctx.translate(tx, ty);
            ctx.rotate(rad + Math.PI / 2);
            ctx.fillText(t.label, 0, 0);
            ctx.restore();
        });

        // Current Roll Red Pointer Triangle
        ctx.save();
        ctx.translate(cx, rollCenterY);
        ctx.rotate((-this.roll * Math.PI) / 180);
        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -rollRadius + 2);
        ctx.lineTo(-6, -rollRadius + 12);
        ctx.lineTo(6, -rollRadius + 12);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();

        ctx.restore();

        // ==========================================
        // 4. TOP HEADING COMPASS TAPE
        // ==========================================
        this.drawCompassTape(ctx, w, h);

        // ==========================================
        // 5. LEFT AIRSPEED TAPE
        // ==========================================
        this.drawSpeedTape(ctx, w, h);

        // ==========================================
        // 6. RIGHT ALTITUDE TAPE
        // ==========================================
        this.drawAltitudeTape(ctx, w, h);

        // ==========================================
        // 7. HUD TELEMETRY DATA OVERLAYS
        // ==========================================
        this.drawHudOverlays(ctx, w, h);

        ctx.restore();
    }

    drawCompassTape(ctx, w, h) {
        const tapeH = Math.round(h * 0.12);
        const tapeY = 0;
        const fontPx = Math.round(tapeH * 0.45);

        // Tape background
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(0, tapeY, w, tapeH);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, tapeY + tapeH);
        ctx.lineTo(w, tapeY + tapeH);
        ctx.stroke();

        // Heading scale (3.5 pixels per degree)
        const pxPerDeg = 3.5;
        const normHeading = (this.heading % 360 + 360) % 360;

        ctx.save();
        ctx.rect(0, tapeY, w, tapeH);
        ctx.clip();

        ctx.font = `600 ${fontPx}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const startDeg = Math.floor(normHeading - 60);
        const endDeg = Math.ceil(normHeading + 60);

        for (let deg = startDeg; deg <= endDeg; deg += 5) {
            const wrapDeg = (deg % 360 + 360) % 360;
            const x = w / 2 + (deg - normHeading) * pxPerDeg;

            if (x < 0 || x > w) continue;

            const isMajor = wrapDeg % 15 === 0;
            const tickH = isMajor ? tapeH * 0.35 : tapeH * 0.2;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineWidth = isMajor ? 1.5 : 1;
            ctx.beginPath();
            ctx.moveTo(x, tapeY);
            ctx.lineTo(x, tapeY + tickH);
            ctx.stroke();

            if (isMajor) {
                let label = wrapDeg.toString();
                if (wrapDeg === 0) label = 'N';
                else if (wrapDeg === 45) label = 'NE';
                else if (wrapDeg === 90) label = 'E';
                else if (wrapDeg === 135) label = 'SE';
                else if (wrapDeg === 180) label = 'S';
                else if (wrapDeg === 225) label = 'SW';
                else if (wrapDeg === 270) label = 'W';
                else if (wrapDeg === 315) label = 'NW';

                ctx.fillStyle = (wrapDeg === 0 || wrapDeg === 90 || wrapDeg === 180 || wrapDeg === 270) ? '#38bdf8' : '#ffffff';
                ctx.fillText(label, x, tapeY + tickH + 2);
            }
        }
        ctx.restore();

        // Center Heading Pointer Box
        const ptrW = fontPx * 3.2;
        const ptrH = tapeH * 0.75;
        const ptrX = w / 2 - ptrW / 2;
        const ptrY = tapeY + 2;

        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(ptrX, ptrY, ptrW, ptrH);
        ctx.strokeRect(ptrX, ptrY, ptrW, ptrH);

        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${fontPx}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(normHeading).toString().padStart(3, '0'), w / 2, ptrY + ptrH / 2);
    }

    drawSpeedTape(ctx, w, h) {
        const tapeW = Math.round(w * 0.16);
        const tapeY = Math.round(h * 0.15);
        const tapeH = Math.round(h * 0.65);
        const fontPx = Math.round(tapeW * 0.28);
        const pxPerUnit = tapeH / 30; // 30 m/s range visible

        // Semi-transparent Box
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(0, tapeY, tapeW, tapeH);
        ctx.strokeRect(0, tapeY, tapeW, tapeH);

        // Green vertical status bar on left edge
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(0, tapeY, 4, tapeH);

        ctx.save();
        ctx.rect(0, tapeY, tapeW, tapeH);
        ctx.clip();

        ctx.font = `600 ${fontPx}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';

        const centerSpeed = this.airspeed || this.groundspeed || 0;
        const startSpd = Math.floor(centerSpeed - 15);
        const endSpd = Math.ceil(centerSpeed + 15);

        for (let spd = Math.max(0, startSpd); spd <= endSpd; spd += 5) {
            const y = tapeY + tapeH / 2 - (spd - centerSpeed) * pxPerUnit;
            if (y < tapeY || y > tapeY + tapeH) continue;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(tapeW - 12, y);
            ctx.lineTo(tapeW, y);
            ctx.stroke();

            ctx.fillText(spd.toString(), tapeW - 16, y);
        }
        ctx.restore();

        // Speed Pointer Tag (Black box on left edge)
        const tagW = tapeW * 1.1;
        const tagH = fontPx * 1.8;
        const tagY = tapeY + tapeH / 2 - tagH / 2;

        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(0, tagY, tagW, tagH);
        ctx.strokeRect(0, tagY, tagW, tagH);

        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${fontPx * 0.9}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Number(centerSpeed).toFixed(0)}m/s`, tagW / 2, tagY + tagH / 2);
    }

    drawAltitudeTape(ctx, w, h) {
        const tapeW = Math.round(w * 0.16);
        const tapeX = w - tapeW;
        const tapeY = Math.round(h * 0.15);
        const tapeH = Math.round(h * 0.65);
        const fontPx = Math.round(tapeW * 0.28);
        const pxPerUnit = tapeH / 40; // 40m range visible

        // Semi-transparent Box
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.strokeStyle = 'rgba(147, 197, 253, 0.6)';
        ctx.lineWidth = 1.5;
        ctx.fillRect(tapeX, tapeY, tapeW, tapeH);
        ctx.strokeRect(tapeX, tapeY, tapeW, tapeH);

        // Green bottom indicator bar
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(tapeX, tapeY + tapeH - 4, tapeW, 4);

        ctx.save();
        ctx.rect(tapeX, tapeY, tapeW, tapeH);
        ctx.clip();

        ctx.font = `600 ${fontPx}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';

        const centerAlt = this.altitude || 0;
        const startAlt = Math.floor(centerAlt - 20);
        const endAlt = Math.ceil(centerAlt + 20);

        for (let alt = Math.max(0, startAlt); alt <= endAlt; alt += 5) {
            const y = tapeY + tapeH / 2 - (alt - centerAlt) * pxPerUnit;
            if (y < tapeY || y > tapeY + tapeH) continue;

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(tapeX, y);
            ctx.lineTo(tapeX + 12, y);
            ctx.stroke();

            ctx.fillText(alt.toString(), tapeX + 16, y);
        }
        ctx.restore();

        // Altitude Pointer Tag (Black box on right edge)
        const tagW = tapeW * 1.1;
        const tagH = fontPx * 1.8;
        const tagX = w - tagW;
        const tagY = tapeY + tapeH / 2 - tagH / 2;

        ctx.fillStyle = '#000000';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(tagX, tagY, tagW, tagH);
        ctx.strokeRect(tagX, tagY, tagW, tagH);

        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${fontPx * 0.9}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Number(centerAlt).toFixed(0)} m`, tagX + tagW / 2, tagY + tagH / 2);
    }

    drawHudOverlays(ctx, w, h) {
        const fontPx = Math.round(Math.min(w, h) * 0.05);

        // 1. TOP RIGHT: Battery & Time
        const now = new Date();
        const timeStr = now.toTimeString().split(' ')[0];
        const batPct = Math.round(this.remaining || 0);

        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#22c55e';
        ctx.font = `700 ${fontPx}px "JetBrains Mono", monospace`;
        ctx.fillText(`🔋 ${batPct}%`, w - 10, h * 0.15 + 4);
        ctx.fillStyle = '#cbd5e1';
        ctx.font = `600 ${fontPx * 0.85}px "JetBrains Mono", monospace`;
        ctx.fillText(timeStr, w - 10, h * 0.15 + fontPx + 6);

        // 2. BOTTOM LEFT OVERLAY: (ARMED)/(SAFE) + Speed Values
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';

        const armText = this.armed ? '(ARMED)' : '(SAFE)';
        const armColor = '#ef4444'; // Bold Red
        ctx.fillStyle = armColor;
        ctx.font = `900 ${Math.round(fontPx * 1.6)}px "JetBrains Mono", monospace`;
        ctx.fillText(armText, w * 0.18, h * 0.77);

        ctx.fillStyle = '#e2e8f0';
        ctx.font = `600 ${Math.round(fontPx * 0.85)}px "JetBrains Mono", monospace`;
        ctx.fillText(`AS ${Number(this.airspeed).toFixed(1)}m/s`, w * 0.18, h * 0.85);
        ctx.fillText(`GS ${Number(this.groundspeed).toFixed(1)}m/s`, w * 0.18, h * 0.91);

        // 3. BOTTOM RIGHT OVERLAY: Mode & Climb/Dist
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `700 ${Math.round(fontPx * 1.05)}px "JetBrains Mono", monospace`;
        ctx.fillText(this.mode || 'STANDBY', w * 0.82, h * 0.85);
        ctx.font = `600 ${Math.round(fontPx * 0.85)}px "JetBrains Mono", monospace`;
        ctx.fillText(`Climb ${Number(this.climb).toFixed(1)}m/s`, w * 0.82, h * 0.91);

        // 4. BOTTOM FOOTER BAR
        const footerY = h - 3;
        const botText = `Bat ${Number(this.voltage).toFixed(2)}v ${Number(this.current).toFixed(1)}A ${Math.round(this.remaining)}%  EKF  Vibe  GPS: ${this.gpsFix}`;

        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#cbd5e1';
        ctx.font = `600 ${Math.round(fontPx * 0.82)}px "JetBrains Mono", monospace`;
        ctx.fillText(botText, w / 2, footerY);
    }
}
