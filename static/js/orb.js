/**
 * WebGL Orb Interactive Animation Renderer (FALCONZ Dark Theme)
 * Features:
 * - Dynamic 3D Simplex Noise Shader
 * - Interactive Mouse Wave & Morphing Distortion
 * - Pulsing Color Glow and Energetic Rotation on Mouse Hover
 */
class OrbRenderer {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.hue = options.hue !== undefined ? options.hue : 230; // Neon Blue / Indigo
        this.hoverIntensity = options.hoverIntensity !== undefined ? options.hoverIntensity : 0.65;
        this.rotateOnHover = options.rotateOnHover !== undefined ? options.rotateOnHover : true;
        this.forceHoverState = options.forceHoverState !== undefined ? options.forceHoverState : false;
        this.backgroundColor = options.backgroundColor || '#070A14';

        this.canvas = document.createElement('canvas');
        this.canvas.className = 'orb-canvas';
        this.container.appendChild(this.canvas);

        this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
        if (!this.gl) {
            console.warn('WebGL not supported for Orb animation');
            return;
        }

        this.initShaders();
        this.initBuffers();
        this.initUniforms();
        this.initEvents();

        this.targetHover = 0;
        this.currentHover = 0;
        this.currentRot = 0;
        this.mouseX = 0;
        this.mouseY = 0;
        this.targetMouseX = 0;
        this.targetMouseY = 0;
        this.lastTime = performance.now();
        this.animating = true;

        this.resize();
        this.animate(performance.now());
    }

    hexToVec3(color) {
        if (color.startsWith('#')) {
            const r = parseInt(color.slice(1, 3), 16) / 255;
            const g = parseInt(color.slice(3, 5), 16) / 255;
            const b = parseInt(color.slice(5, 7), 16) / 255;
            return [r, g, b];
        }
        return [0.03, 0.04, 0.08]; // Default #070A14
    }

    initShaders() {
        const vertShaderSource = `
            precision highp float;
            attribute vec2 position;
            attribute vec2 uv;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 0.0, 1.0);
            }
        `;

        const fragShaderSource = `
            precision highp float;

            uniform float iTime;
            uniform vec3 iResolution;
            uniform vec2 iMouse;
            uniform float hue;
            uniform float hover;
            uniform float rot;
            uniform float hoverIntensity;
            uniform vec3 backgroundColor;
            varying vec2 vUv;

            vec3 rgb2yiq(vec3 c) {
                float y = dot(c, vec3(0.299, 0.587, 0.114));
                float i = dot(c, vec3(0.596, -0.274, -0.322));
                float q = dot(c, vec3(0.211, -0.523, 0.312));
                return vec3(y, i, q);
            }
            
            vec3 yiq2rgb(vec3 c) {
                float r = c.x + 0.956 * c.y + 0.621 * c.z;
                float g = c.x - 0.272 * c.y - 0.647 * c.z;
                float b = c.x - 1.106 * c.y + 1.703 * c.z;
                return vec3(r, g, b);
            }
            
            vec3 adjustHue(vec3 color, float hueDeg) {
                float hueRad = hueDeg * 3.14159265 / 180.0;
                vec3 yiq = rgb2yiq(color);
                float cosA = cos(hueRad);
                float sinA = sin(hueRad);
                float i = yiq.y * cosA - yiq.z * sinA;
                float q = yiq.y * sinA + yiq.z * cosA;
                yiq.y = i;
                yiq.z = q;
                return yiq2rgb(yiq);
            }

            vec3 hash33(vec3 p3) {
                p3 = fract(p3 * vec3(0.1031, 0.11369, 0.13787));
                p3 += dot(p3, p3.yxz + 19.19);
                return -1.0 + 2.0 * fract(vec3(
                    p3.x + p3.y,
                    p3.x + p3.z,
                    p3.y + p3.z
                ) * p3.zyx);
            }

            float snoise3(vec3 p) {
                const float K1 = 0.333333333;
                const float K2 = 0.166666667;
                vec3 i = floor(p + (p.x + p.y + p.z) * K1);
                vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
                vec3 e = step(vec3(0.0), d0 - d0.yzx);
                vec3 i1 = e * (1.0 - e.zxy);
                vec3 i2 = 1.0 - e.zxy * (1.0 - e);
                vec3 d1 = d0 - (i1 - K2);
                vec3 d2 = d0 - (i2 - K1);
                vec3 d3 = d0 - 0.5;
                vec4 h = max(0.6 - vec4(
                    dot(d0, d0),
                    dot(d1, d1),
                    dot(d2, d2),
                    dot(d3, d3)
                ), 0.0);
                vec4 n = h * h * h * h * vec4(
                    dot(d0, hash33(i)),
                    dot(d1, hash33(i + i1)),
                    dot(d2, hash33(i + i2)),
                    dot(d3, hash33(i + 1.0))
                );
                return dot(vec4(31.316), n);
            }

            vec4 extractAlpha(vec3 colorIn) {
                float a = max(max(colorIn.r, colorIn.g), colorIn.b);
                return vec4(colorIn.rgb / (a + 1e-5), a);
            }

            const vec3 baseColor1 = vec3(0.231, 0.356, 1.000); // FALCONZ Electric Blue
            const vec3 baseColor2 = vec3(0.658, 0.333, 0.980); // FALCONZ Neon Purple
            const vec3 baseColor3 = vec3(0.027, 0.039, 0.082); // FALCONZ Deep Dark
            const float innerRadius = 0.55;
            const float noiseScale = 0.75;

            float light1(float intensity, float attenuation, float dist) {
                return intensity / (1.0 + dist * attenuation);
            }
            float light2(float intensity, float attenuation, float dist) {
                return intensity / (1.0 + dist * dist * attenuation);
            }

            vec4 draw(vec2 uv) {
                // Dynamic mouse interactive hue shift on hover
                float dynamicHue = hue + hover * 35.0 * sin(iTime * 1.5);
                vec3 color1 = adjustHue(baseColor1, dynamicHue);
                vec3 color2 = adjustHue(baseColor2, dynamicHue);
                vec3 color3 = adjustHue(baseColor3, dynamicHue);
                
                float ang = atan(uv.y, uv.x);
                float len = length(uv);
                float invLen = len > 0.0 ? 1.0 / len : 0.0;

                float bgLuminance = dot(backgroundColor, vec3(0.299, 0.587, 0.114));
                
                float n0 = snoise3(vec3(uv * noiseScale, iTime * 0.7)) * 0.5 + 0.5;
                float r0 = mix(mix(innerRadius, 1.0, 0.4), mix(innerRadius, 1.0, 0.6), n0);
                float d0 = distance(uv, (r0 * invLen) * uv);
                float v0 = light1(1.2, 8.0, d0);

                v0 *= smoothstep(r0 * 1.08, r0, len);
                float innerFade = smoothstep(r0 * 0.75, r0 * 0.95, len);
                v0 *= mix(innerFade, 1.0, bgLuminance * 0.7);
                float cl = cos(ang + iTime * 2.5) * 0.5 + 0.5;
                
                float a = iTime * -1.2;
                vec2 pos = vec2(cos(a), sin(a)) * r0;
                float d = distance(uv, pos);
                float v1 = light2(1.8, 4.0, d);
                v1 *= light1(1.2, 40.0, d0);
                
                float v2 = smoothstep(1.0, mix(innerRadius, 1.0, n0 * 0.5), len);
                float v3 = smoothstep(innerRadius, mix(innerRadius, 1.0, 0.5), len);
                
                vec3 colBase = mix(color1, color2, cl);
                float fadeAmount = mix(1.0, 0.1, bgLuminance);
                
                vec3 darkCol = mix(color3, colBase, v0);
                darkCol = (darkCol + v1) * v2 * v3;
                
                // Add hover glow boost
                darkCol += colBase * hover * 0.3 * (1.0 - smoothstep(0.0, 0.8, len));
                darkCol = clamp(darkCol, 0.0, 1.0);
                
                vec3 lightCol = (colBase + v1) * mix(1.0, v2 * v3, fadeAmount);
                lightCol = mix(backgroundColor, lightCol, v0);
                lightCol = clamp(lightCol, 0.0, 1.0);
                
                vec3 finalCol = mix(darkCol, lightCol, bgLuminance);
                
                return extractAlpha(finalCol);
            }

            vec4 mainImage(vec2 fragCoord) {
                vec2 center = iResolution.xy * 0.5;
                float size = min(iResolution.x, iResolution.y);
                vec2 uv = (fragCoord - center) / size * 2.0;
                
                float angle = rot;
                float s = sin(angle);
                float c = cos(angle);
                uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
                
                // Interactive mouse wave distortion ripples
                float mDist = length(uv - iMouse);
                float wave = sin(mDist * 16.0 - iTime * 4.0) * exp(-mDist * 2.5);
                uv.x += hover * hoverIntensity * 0.32 * (sin(uv.y * 12.0 + iTime * 3.0) + wave);
                uv.y += hover * hoverIntensity * 0.32 * (cos(uv.x * 12.0 + iTime * 3.0) + wave);
                
                return draw(uv);
            }

            void main() {
                vec2 fragCoord = vUv * iResolution.xy;
                vec4 col = mainImage(fragCoord);
                gl_FragColor = vec4(col.rgb * col.a, col.a);
            }
        `;

        const compileShader = (src, type) => {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, src);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                console.error('Orb shader compile error:', this.gl.getShaderInfoLog(shader));
            }
            return shader;
        };

        const vertShader = compileShader(vertShaderSource, this.gl.VERTEX_SHADER);
        const fragShader = compileShader(fragShaderSource, this.gl.FRAGMENT_SHADER);

        this.program = this.gl.createProgram();
        this.gl.attachShader(this.program, vertShader);
        this.gl.attachShader(this.program, fragShader);
        this.gl.linkProgram(this.program);
        this.gl.useProgram(this.program);
    }

    initBuffers() {
        const positions = new Float32Array([
            -1.0, -1.0,
             1.0, -1.0,
            -1.0,  1.0,
            -1.0,  1.0,
             1.0, -1.0,
             1.0,  1.0
        ]);

        const uvs = new Float32Array([
            0.0, 0.0,
            1.0, 0.0,
            0.0, 1.0,
            0.0, 1.0,
            1.0, 0.0,
            1.0, 1.0
        ]);

        const posBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, posBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, positions, this.gl.STATIC_DRAW);

        const posAttr = this.gl.getAttribLocation(this.program, 'position');
        this.gl.enableVertexAttribArray(posAttr);
        this.gl.vertexAttribPointer(posAttr, 2, this.gl.FLOAT, false, 0, 0);

        const uvBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, uvBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, uvs, this.gl.STATIC_DRAW);

        const uvAttr = this.gl.getAttribLocation(this.program, 'uv');
        this.gl.enableVertexAttribArray(uvAttr);
        this.gl.vertexAttribPointer(uvAttr, 2, this.gl.FLOAT, false, 0, 0);
    }

    initUniforms() {
        this.uTime = this.gl.getUniformLocation(this.program, 'iTime');
        this.uResolution = this.gl.getUniformLocation(this.program, 'iResolution');
        this.uMouse = this.gl.getUniformLocation(this.program, 'iMouse');
        this.uHue = this.gl.getUniformLocation(this.program, 'hue');
        this.uHover = this.gl.getUniformLocation(this.program, 'hover');
        this.uRot = this.gl.getUniformLocation(this.program, 'rot');
        this.uHoverIntensity = this.gl.getUniformLocation(this.program, 'hoverIntensity');
        this.uBackgroundColor = this.gl.getUniformLocation(this.program, 'backgroundColor');
    }

    initEvents() {
        window.addEventListener('resize', () => this.resize());

        const targetArea = document.getElementById('view-home') || window;

        const handleMouseMove = (e) => {
            const rect = this.container.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const width = rect.width;
            const height = rect.height;
            const size = Math.min(width, height);
            const centerX = width / 2;
            const centerY = height / 2;
            
            this.targetMouseX = ((x - centerX) / size) * 2.0;
            this.targetMouseY = -((y - centerY) / size) * 2.0; // Invert Y for GLSL coordinates

            const distFromCenter = Math.sqrt(this.targetMouseX * this.targetMouseX + this.targetMouseY * this.targetMouseY);

            if (distFromCenter < 1.25) {
                this.targetHover = 1;
            } else {
                this.targetHover = 0;
            }
        };

        const handleMouseLeave = () => {
            this.targetHover = 0;
        };

        targetArea.addEventListener('mousemove', handleMouseMove);
        targetArea.addEventListener('mouseleave', handleMouseLeave);
    }

    resize() {
        if (!this.container || !this.canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.canvas.width = width * dpr;
        this.canvas.height = height * dpr;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';

        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.uniform3f(this.uResolution, this.canvas.width, this.canvas.height, this.canvas.width / this.canvas.height);
    }

    animate(t) {
        if (!this.animating) return;

        const dt = (t - this.lastTime) * 0.001;
        this.lastTime = t;

        this.gl.useProgram(this.program);
        this.gl.uniform1f(this.uTime, t * 0.001);
        this.gl.uniform1f(this.uHue, this.hue);
        this.gl.uniform1f(this.uHoverIntensity, this.hoverIntensity);

        // Smooth mouse coords lerp
        this.mouseX += (this.targetMouseX - this.mouseX) * 0.15;
        this.mouseY += (this.targetMouseY - this.mouseY) * 0.15;
        this.gl.uniform2f(this.uMouse, this.mouseX, this.mouseY);

        const bgVec = this.hexToVec3(this.backgroundColor);
        this.gl.uniform3f(this.uBackgroundColor, bgVec[0], bgVec[1], bgVec[2]);

        const effectiveHover = this.forceHoverState ? 1 : this.targetHover;
        this.currentHover += (effectiveHover - this.currentHover) * 0.08;
        this.gl.uniform1f(this.uHover, this.currentHover);

        if (this.rotateOnHover && effectiveHover > 0.1) {
            this.currentRot += dt * (0.4 + this.currentHover * 0.8); // Accelerate rotation on hover
        }
        this.gl.uniform1f(this.uRot, this.currentRot);

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

        requestAnimationFrame((time) => this.animate(time));
    }
}

// Auto-initialize Orb background on Home Hero section
document.addEventListener('DOMContentLoaded', () => {
    const orbContainer = document.getElementById('orb-container');
    if (orbContainer) {
        window.orbInstance = new OrbRenderer('orb-container', {
            hue: 230, // FALCONZ Electric Blue
            hoverIntensity: 0.7,
            rotateOnHover: true,
            forceHoverState: false,
            backgroundColor: '#070A14' // Sleek Dark Background
        });
    }
});
