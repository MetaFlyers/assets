import * as THREE from "https://cdn.skypack.dev/three@0.130.1?min";
import { OrbitControls } from "//cdn.skypack.dev/three@0.130.1/examples/jsm/controls/OrbitControls?min";
import Stats from "//cdn.skypack.dev/stats.js";
import * as dat from "//cdn.skypack.dev/dat.gui";

const URLBase = location.href.split('?')[0];
const URLParams = new URLSearchParams(location.search);

function getMixVal(type) {
    if(type === "difference") return 0;
    else if(type === "addMin") return 1;
    else if(type === "addMax") return 2;
    else return 3;
}

const guiVars = {
    inputTexture: URLParams.get("inputTexture") || "circleTexture",
    textureVars: {
        reverseScaleDir: parseFloat(URLParams.get("reverseScaleDir")) || false,
        radiusMultiplier: parseFloat(URLParams.get("radiusMultiplier")) || 0.1,
        maxAge: parseInt(URLParams.get("maxAge")) || 64,
        offsetMultiplier: parseFloat(URLParams.get("offsetMultiplier")) || 5,
        shadowMultiplier: parseFloat(URLParams.get("shadowMultiplier")) || 1,
        clearColor: URLParams.get("clearColor") ? URLParams.get("clearColor").replace("%23", "#") : "#050505"
    },
    voronoiMultiplier: parseFloat(URLParams.get("voronoiMultiplier")) || 4.7,
    vononoiMixType: URLParams.get("vononoiMixType") || "addMin",
    origVononoiMixVal: getMixVal(URLParams.get("vononoiMixType")  || "addMin"),
    voronoiSpacing: parseFloat(URLParams.get("voronoiSpacing")) || 0.02,
    forceColor: URLParams.get("forceColor") === "true" || false,
    colorFilter: URLParams.get("colorFilter") ? URLParams.get("colorFilter").replace("%23", "#") : "#000000"
}

const gui = new dat.GUI();

const canvas = document.querySelector('canvas.webgl');
const scene = new THREE.Scene();

const loader = new THREE.TextureLoader();

const noise = loader.load('https://assets.codepen.io/37111/noise.png');
noise.minFilter = noise.magFilter = THREE.NearestFilter;
noise.wrapS = noise.wrapT = THREE.RepeatWrapping;

const detailNoise = loader.load('https://assets.codepen.io/37111/bayer8x8.png');
detailNoise.wrapS = detailNoise.wrapT = THREE.RepeatWrapping;


loadClasses();
const waterTexture = new WaterTexture({ debug: false });
window.addEventListener("pointermove", (e) => {
    const point = {
        x: e.clientX / innerWidth,
        y: e.clientY / innerHeight
    };

    waterTexture.addPoint(point);
});
const waterInput = new THREE.CanvasTexture(waterTexture.canvas);

const circleTexture = new CircleTexture({ debug: false });
window.addEventListener("pointermove", (e) => {
    const point = {
        x: e.clientX / innerWidth,
        y: e.clientY / innerHeight
    };

    circleTexture.addPoint(point);
});
const circleInput = new THREE.CanvasTexture(circleTexture.canvas);

guiVars.origInput = URLParams.get("inputTexture") === "waterTexture" ? waterInput : circleInput;
circleTexture.updateRadiusScaleDir(guiVars.textureVars.reverseScaleDir);
circleTexture.updateRadiusMultiplier(guiVars.textureVars.radiusMultiplier);
waterTexture.updateRadiusMultiplier(guiVars.textureVars.radiusMultiplier);
circleTexture.updateMaxAge(guiVars.textureVars.maxAge);
waterTexture.updateMaxAge(guiVars.textureVars.maxAge);
circleTexture.updateOffsetMultiplier(guiVars.textureVars.offsetMultiplier);
waterTexture.updateOffsetMultiplier(guiVars.textureVars.offsetMultiplier);
circleTexture.updateShadowMultiplier(guiVars.textureVars.shadowMultiplier);
waterTexture.updateShadowMultiplier(guiVars.textureVars.shadowMultiplier);
circleTexture.updateClearColor(guiVars.textureVars.clearColor);
waterTexture.updateClearColor(guiVars.textureVars.clearColor);

const geometry = new THREE.PlaneGeometry(2, 2);

const initFilterColor = hexToRgbNormalized(guiVars.colorFilter);
const material = new THREE.RawShaderMaterial({
    vertexShader: `
precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
    `,
    fragmentShader: `
precision highp float;
precision highp int;

uniform float uTime;
uniform sampler2D uNoise;
uniform sampler2D uDetailNoise;
uniform sampler2D uInput;
uniform vec3 uResolution;

uniform float uVoronoiScale;
uniform int uVoronoiMixType;
uniform float uVoronoiSpacing;

uniform bool uForceColor;
uniform vec3 uFilterColor;

varying vec2 vUv;

#define AA (20./uResolution.y)

float smin( float a, float b, float k ){
    float h = clamp( 0.5+0.5*(b-a)/k, 0.0, 1.0 );
    return mix( b, a, h ) - k*h*(1.0-h);
}

vec3 hsv2rgb(vec3 c) {
  // Íñigo Quílez
  // https://www.shadertoy.com/view/MsS3Wc
  vec3 rgb = clamp(abs(mod(c.x*6.+vec3(0.,4.,2.),6.)-3.)-1.,0.,1.);
  rgb = rgb * rgb * (3. - 2. * rgb);
  return c.z * mix(vec3(1.), rgb, c.y);
}

vec2 hash2( vec2 p ) {
	return texture2D( uNoise, (p+0.5)/256.0, 0.0 ).xy;
}

vec3 voronoi( in vec2 x ) {
    vec2 n = floor(x);
    vec2 f = fract(x);

    //----------------------------------
    // first pass: regular voronoi
    //----------------------------------
	vec2 mg, mr;

    float md = 8.0;
    for( int j=-1; j<=1; j++ )
    for( int i=-1; i<=1; i++ )
    {
        vec2 g = vec2(float(i),float(j));
        vec2 o = 0.5 + 0.5*sin( uTime + 6.2831*hash2( n + g ) );
        vec2 r = g + o - f;
        float d = dot(r,r);

        if( d<md )
        {
            md = d;
            mr = r;
            mg = g;
        }
    }

    //----------------------------------
    // second pass: distance to borders
    //----------------------------------
    md = 8.0;
    for( int j=-2; j<=2; j++ )
    for( int i=-2; i<=2; i++ )
    {
        vec2 g = mg + vec2(float(i),float(j));
        vec2 o = 0.5 + 0.5*sin( uTime + 6.2831*hash2( n + g ) );
        vec2 r = g + o - f;

        if( dot(mr-r,mr-r)>0.00001 )
        md = smin( md, dot(0.5*(mr+r), normalize(r-mr)), .2);
    }

    return vec3( md, n + mg );
}

void mainImage( vec4 fragColor, vec2 fragCoord ) {
    vec2 myUv = (2. * fragCoord - uResolution.xy)/uResolution.y;
    myUv *= uVoronoiScale;
    myUv.y -= .5;

    vec4 detail = texture2D(uDetailNoise, myUv, 0.0);
    
    vec3 vor = voronoi(myUv);
    vec3 vor2 = voronoi(vec2(detail.r, length(myUv)) * vec2(48., 4.));
    
    if( uVoronoiMixType == 0 ) vor -= vor2 - vor;
    else if( uVoronoiMixType == 1 ) vor += min(vor, vor2);
    else if( uVoronoiMixType == 2 ) vor += max(vor, vor2);

    vec4 mouseInput = texture2D(uInput, vUv);

    if(uForceColor) {
        gl_FragColor = .1 + vec4(uFilterColor, 1.)
            * smoothstep(uVoronoiSpacing + AA, .02, distance(1. - fract(pow(detail.r* mouseInput.r, .25)), vor.x));
    } else {
        gl_FragColor = .1 + vec4(hsv2rgb(vec3(atan(vor.y, vor.z), 0.7, 0.9)), 1.)
              * smoothstep(uVoronoiSpacing + AA, .02, distance(1. - fract(pow(detail.r* mouseInput.r, .25)), vor.x));
    }
}

void main() {
    mainImage(gl_FragColor, vUv * uResolution.xy);
}
    `,
    uniforms: {
        uTime: { value: 0 },
        uNoise: { value: noise },
        uDetailNoise: { value: detailNoise },
        uInput: { value: guiVars.origInput },
        uResolution: { type: "v3", value: new THREE.Vector3() },
        uVoronoiScale: { value: guiVars.voronoiMultiplier },
        uVoronoiMixType: { type: "int", value: guiVars.origVononoiMixVal },
        uVoronoiSpacing: { value: guiVars.voronoiSpacing },
        uFilterColor: { type: "v3", value: new THREE.Vector3(initFilterColor.r, initFilterColor.g, initFilterColor.b) },
        uForceColor: { type: "bool", value: guiVars.forceColor }
    }
});

// GUI stuff
gui
.add(guiVars, "inputTexture", ["circleTexture", "waterTexture"])
.onChange(value => {
    const val = value === "circleTexture" ? circleInput : waterInput;
    material.uniforms.uInput.value = val;

    URLParams.set('inputTexture', value);
    updateURLParams();
})

const mouseFollowerFolder = gui.addFolder('Mouse Follower Vars');
mouseFollowerFolder.add(guiVars.textureVars, 'reverseScaleDir').onChange(value => {
    circleTexture.updateRadiusScaleDir(value);

    URLParams.set('reverseScaleDir', value);
    updateURLParams();
});
mouseFollowerFolder.add(guiVars.textureVars, 'radiusMultiplier', 0, 0.5).onChange(value => {
    circleTexture.updateRadiusMultiplier(value);
    waterTexture.updateRadiusMultiplier(value);

    URLParams.set('radiusMultiplier', value);
    updateURLParams();
});
mouseFollowerFolder.add(guiVars.textureVars, 'maxAge', 1, 150).onChange(value => {
    circleTexture.updateMaxAge(value);
    waterTexture.updateMaxAge(value);

    URLParams.set('maxAge', value);
    updateURLParams();
});
mouseFollowerFolder.add(guiVars.textureVars, 'offsetMultiplier', 0, 10).onChange(value => {
    circleTexture.updateOffsetMultiplier(value);
    waterTexture.updateOffsetMultiplier(value);

    URLParams.set('offsetMultiplier', value);
    updateURLParams();
});
mouseFollowerFolder.add(guiVars.textureVars, 'shadowMultiplier', 0, 5).onChange(value => {
    circleTexture.updateShadowMultiplier(value);
    waterTexture.updateShadowMultiplier(value);

    URLParams.set('shadowMultiplier', value);
    updateURLParams();
});
mouseFollowerFolder.addColor(guiVars.textureVars, 'clearColor').onChange(value => {
    circleTexture.updateClearColor(value);
    waterTexture.updateClearColor(value);

    URLParams.set('clearColor', value);
    updateURLParams();
});

const voronoiFolder = gui.addFolder('Voronoi Vars');
voronoiFolder
.add(guiVars, "voronoiMultiplier", 0.1, 10)
.onChange(value => {
    material.uniforms.uVoronoiScale.value = value;

    URLParams.set('voronoiMultiplier', value);
    updateURLParams();
})

voronoiFolder
.add(guiVars, "vononoiMixType", ["difference", "addMin", "addMax", "none"])
.onChange(value => {
    material.uniforms.uVoronoiMixType.value = getMixVal(value);

    URLParams.set('vononoiMixType', value);
    updateURLParams();
})

voronoiFolder
.add(guiVars, "voronoiSpacing", 0.001, 1)
.onChange(value => {
    material.uniforms.uVoronoiSpacing.value = value;

    URLParams.set('voronoiSpacing', value);
    updateURLParams();
})

function hexToRgbNormalized(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16) / 255,
        g: parseInt(result[2], 16) / 255,
        b: parseInt(result[3], 16) / 255
    } : null;
}

const colorFolder = gui.addFolder('Color Vars');
colorFolder.add(guiVars, "forceColor").onChange(value => {
    material.uniforms.uForceColor.value = value;

    URLParams.set('forceColor', value);
    updateURLParams();
})
colorFolder.addColor(guiVars, "colorFilter").onChange(value => {
    const newColor = hexToRgbNormalized(value);
    material.uniforms.uFilterColor.value = new THREE.Vector3(newColor.r, newColor.g, newColor.b);

    URLParams.set('colorFilter', value);
    updateURLParams();
})


const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

const sizes = {};

const resize = () => {
    sizes.width = innerWidth;
    sizes.height = innerHeight;

    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    const canvas = renderer.domElement;
    material.uniforms.uResolution.value.set(canvas.width, canvas.height, 1);
};

window.addEventListener('resize', resize);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
scene.add(camera);

const renderer = new THREE.WebGLRenderer({ canvas: canvas });

const clock = new THREE.Clock();

const tick = () => {
    material.uniforms.uTime.value = clock.getElapsedTime();

    if(guiVars.inputTexture === "circleTexture") {
        circleTexture.update();
        circleInput.needsUpdate = true;
    } else if(guiVars.inputTexture === "waterTexture") {
        waterTexture.update();
        waterInput.needsUpdate = true;
    }

    renderer.render(scene, camera);

    window.requestAnimationFrame(tick);
};

const updateURLParams = () => {
    try {
        const newURL = URLBase + "?" + URLParams.toString();
        history.replaceState({ path: newURL }, '', newURL);
    } catch(e) {};
};

resize();
tick();


function loadClasses() {
    window.CircleTexture = class CircleTexture {
      constructor(options) {
        this.debug = options.debug;
        this.points = [];

        this.size = 64;
        this.width = this.height = this.size;

        if (this.debug) {
          this.width = window.innerWidth;
          this.height = window.innerHeight;
        }

        this.updateRadiusScaleDir(false);
        this.updateRadiusMultiplier(0.1);
        this.updateMaxAge(64);
        this.updateOffsetMultiplier(5);
        this.updateShadowMultiplier(1);
        this.updateClearColor("#050505");

        this.initTexture();
        if (this.debug) document.body.append(this.canvas);
      }

      updateRadiusScaleDir = (bool) => this.reverseRadiusScaleDir = bool;
      updateRadiusMultiplier(multiplier) {
        this.radius = this.size * multiplier;
        if (this.debug) this.radius = this.width * multiplier;
      }
      updateMaxAge = (age) => this.maxAge = age;
      updateOffsetMultiplier = (multiplier) => this.offsetMultiplier = multiplier;
      updateShadowMultiplier = (multiplier) => this.shadowMultiplier = multiplier;
      updateClearColor = (color) => this.clearColor = color;

      // Initialize our canvas
      initTexture() {
        this.canvas = document.createElement("canvas");
        this.canvas.id = "CircleTexture";
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext("2d");
        this.clear();
      }
      clear() {
        this.ctx.fillStyle = this.clearColor;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
      addPoint(point) {
        this.points.push({ x: point.x, y: point.y, age: 0 });
      }
      update() {
        this.clear();
        this.points.forEach((point, i) => {
          point.age += 1;
          if (point.age > this.maxAge) {
            this.points.splice(i, 1);
          }
        });

        this.points.forEach(point => {
          this.drawPoint(point);
        });
      }
      drawPoint(point) {
        // Convert normalized position into canvas coordinates
        const pos = {
          x: point.x * this.width,
          y: point.y * this.height
        };

        const radius = this.reverseRadiusScaleDir ? this.radius - this.radius * (point.age / this.maxAge) : this.radius * (point.age / this.maxAge);
        const ctx = this.ctx;

        const intensity = 1 - point.age / this.maxAge;

        const color = "255,255,255";

        let offset = this.width * this.offsetMultiplier;
        // 1. Give the shadow a high offset.
        ctx.shadowOffsetX = offset;
        ctx.shadowOffsetY = offset;
        ctx.shadowBlur = radius * this.shadowMultiplier;
        ctx.shadowColor = `rgba(${color},${0.2 * intensity})`;

        this.ctx.beginPath();
        this.ctx.fillStyle = "rgba(255,0,0,1)";
        // 2. Move the circle to the other direction of the offset
        this.ctx.arc(pos.x - offset, pos.y - offset, radius, 0, Math.PI * 2);
        this.ctx.fill();
      }
  }

  window.WaterTexture = class WaterTexture {
    constructor(options) {
      this.debug = options.debug;
      this.points = [];
      this.last = null;

      this.size = 64;
      this.width = this.height = this.size;

      if (this.debug) {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
      }

      this.updateRadiusMultiplier(0.1);
      this.updateMaxAge(64);
      this.updateOffsetMultiplier(5);
      this.updateShadowMultiplier(1);
      this.updateClearColor("#050505");

      this.initTexture();
      if (this.debug) document.body.append(this.canvas);
    }

    updateRadiusMultiplier(multiplier) {
      this.radius = this.size * multiplier;
      if (this.debug) this.radius = this.width * multiplier;
    }
    updateMaxAge = (age) => this.maxAge = age;
    updateOffsetMultiplier = (multiplier) => this.offsetMultiplier = multiplier;
    updateShadowMultiplier = (multiplier) => this.shadowMultiplier = multiplier;
    updateClearColor = (color) => this.clearColor = color;

    // Initialize our canvas
    initTexture() {
      this.canvas = document.createElement("canvas");
      this.canvas.id = "WaterTexture";
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.ctx = this.canvas.getContext("2d");
      this.clear();
    }
    clear() {
      this.ctx.fillStyle = this.clearColor;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    addPoint(point) {
      let force = 0;
      let vx = 0;
      let vy = 0;
      const last = this.last;
      if (last) {
        const relativeX = point.x - last.x;
        const relativeY = point.y - last.y;
        // Distance formula
        const distanceSquared = relativeX * relativeX + relativeY * relativeY;
        const distance = Math.sqrt(distanceSquared);
        // Calculate Unit Vector
        vx = relativeX / distance;
        vy = relativeY / distance;

        force = Math.min(distanceSquared * 10000, 1);
      }

      this.last = {
        x: point.x,
        y: point.y
      };
      this.points.push({ x: point.x, y: point.y, age: 0, force, vx, vy });
    }
    update() {
      this.clear();
      let agePart = 1 / this.maxAge;
      this.points.forEach((point, i) => {
        let slowAsOlder = 1 - point.age / this.maxAge;
        let force = point.force * agePart * slowAsOlder;
        point.x += point.vx * force;
        point.y += point.vy * force;
        point.age += 1;
        if (point.age > this.maxAge) {
          this.points.splice(i, 1);
        }
      });
      this.points.forEach(point => {
        this.drawPoint(point);
      });
    }
    drawPoint(point) {
      // Convert normalized position into canvas coordinates
      let pos = {
        x: point.x * this.width,
        y: point.y * this.height
      };
      const radius = this.radius;
      const ctx = this.ctx;

      let intensity = 1;
      intensity = 1 - point.age / this.maxAge;

      let color = "255,255,255";

      let offset = this.width * this.offsetMultiplier;
      // 1. Give the shadow a high offset.
      ctx.shadowOffsetX = offset;
      ctx.shadowOffsetY = offset;
      ctx.shadowBlur = radius * this.shadowMultiplier;
      ctx.shadowColor = `rgba(${color},${0.2 * intensity})`;

      this.ctx.beginPath();
      this.ctx.fillStyle = "rgba(255,0,0,1)";
      // 2. Move the circle to the other direction of the offset
      this.ctx.arc(pos.x - offset, pos.y - offset, radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }
}
