"use client"

import { Canvas, useLoader, useThree, useFrame } from '@react-three/fiber'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader'
import * as THREE from 'three'
import { Suspense, useEffect, useRef, useState } from 'react'
import { Html, useProgress } from '@react-three/drei'
import { HexColorPicker, HexColorInput } from 'react-colorful'

/* ---------- Ikony + preload ---------- */
const ICONS = {
  eye: '/icons/Eye.png',
  eyeOff: '/icons/Eye-off.png',
  arrowClosed: '/icons/Arrow-closed.svg',
  arrowOpen: '/icons/Arrow-open.svg',
  bulb: '/icons/Bulb.png',
  flashlight: '/icons/Flashlight.png',
}
function PreloadIcons() {
  useEffect(() => {
    Object.values(ICONS).forEach((src) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = src
    })
  }, [])
  return null
}

/* ---------- Helpers ---------- */
const DEFAULT_LOGO = '/Arthetic_logo.png' // máš už nastavené

function stripExt(s){ return s?.replace(/\.[^.]+$/,"") || "" }
function clamp01(x){ return Math.max(0, Math.min(1, x)) }
function getParam(name){
  if (typeof window === "undefined") return null
  return new URL(window.location.href).searchParams.get(name)
}
async function fetchJSON(url){
  const r = await fetch(url,{ cache:"no-store" })
  if(!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/* ---------- Loader ---------- */
function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div style={{ background: 'rgba(0,0,0,0.7)', padding: '20px 40px', borderRadius: '10px', color: 'white', fontFamily: 'sans-serif', fontSize: '18px' }}>
        ⏳ Načítání modelů: {Math.round(progress)} %
      </div>
    </Html>
  )
}

/* ---------- 3D model ---------- */
function Model({ url, color, opacity, visible, onLoaded }) {
  const obj = useLoader(OBJLoader, url)
  useEffect(() => { if (obj && onLoaded) onLoaded(obj) }, [obj, onLoaded])
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    transparent: opacity < 1,
    opacity,
    metalness: 0.5,
    roughness: 0.5,
    side: THREE.DoubleSide,
    depthWrite: opacity === 1,
  })
  obj.traverse((child) => { if (child.isMesh) child.material = material })
  return visible ? <primitive object={obj} /> : null
}

/* ---------- Ovládání kamery ---------- */
function TouchTrackballControls() {
  const { camera, gl } = useThree()
  const controlsRef = useRef(null)
  useEffect(() => {
    const controls = new TrackballControls(camera, gl.domElement)
    controls.rotateSpeed = 5.0
    controls.zoomSpeed = 1.2
    controls.panSpeed = 1.0
    controls.staticMoving = true
    controlsRef.current = controls
    const handleTouchStart = (e) => { e.preventDefault(); controls.handleTouchStart(e) }
    const handleTouchMove  = (e) => { e.preventDefault(); controls.handleTouchMove(e) }
    gl.domElement.addEventListener('touchstart', handleTouchStart, { passive: false })
    gl.domElement.addEventListener('touchmove',  handleTouchMove,  { passive: false })
    return () => {
      gl.domElement.removeEventListener('touchstart', handleTouchStart)
      gl.domElement.removeEventListener('touchmove',  handleTouchMove)
      controls.dispose()
    }
  }, [camera, gl])
  useFrame(() => {
    if (controlsRef.current && camera.isOrthographicCamera) {
      controlsRef.current.panSpeed = camera.zoom * 0.4
      controlsRef.current.update()
    }
  })
  return null
}

/* ---------- Auto-fit kamery ---------- */
function FitCameraOnLoad({ objects, expectedCount = 1, margin = 1.2, isMobile = false, desktopScale = 0.40, mobileScale = 1.0 }) {
  const { camera, size } = useThree()
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return
    if (!objects || objects.length < expectedCount) return
    const box = new THREE.Box3()
    objects.forEach((obj) => box.expandByObject(obj))
    if (box.isEmpty()) return
    const center = new THREE.Vector3()
    const dims = new THREE.Vector3()
    box.getCenter(center); box.getSize(dims)
    camera.position.set(center.x, center.y, camera.position.z)
    const objW = Math.max(dims.x, 1e-6)
    const objH = Math.max(dims.y, 1e-6)
    const zoomX = size.width  / (objW * margin)
    const zoomY = size.height / (objH * margin)
    let newZoom = Math.min(zoomX, zoomY)
    newZoom *= isMobile ? mobileScale : desktopScale
    camera.zoom = Math.max(newZoom, 0.01)
    camera.updateProjectionMatrix()
    fitted.current = true
  }, [objects, expectedCount, margin, isMobile, desktopScale, mobileScale, camera, size.width, size.height])
  return null
}

/* ---------- Color popover ---------- */
function ColorSwatch({ color, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  useEffect(() => {
    const onDocClick = (e) => { if (open && containerRef.current && !containerRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])
  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        aria-label={ariaLabel || 'color picker'}
        onClick={() => setOpen((v) => !v)}
        className="swatch-btn"
        style={{
          width: 36, height: 22, borderRadius: 4, border: '1px solid #fff',
          background: color, cursor: 'pointer', boxShadow: '0 0 0 1px rgba(0,0,0,.25) inset',
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute', zIndex: 20, top: 28, left: 0, background: 'rgba(0,0,0,.92)',
            padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)',
            backdropFilter: 'blur(4px)', boxShadow: '0 6px 24px rgba(0,0,0,.35)',
          }}
        >
          <HexColorPicker color={color} onChange={onChange} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <span style={{ color: '#fff', fontSize: 12 }}>#</span>
            <HexColorInput
              color={color}
              onChange={onChange}
              prefixed={false}
              style={{
                width: 90, padding: '4px 6px', borderRadius: 6, border: '1px solid #444',
                background: '#111', color: '#fff', fontFamily: 'monospace', fontSize: 12,
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Page ---------- */
export default function Page() {
  // světla
  const [lightIntensity, setLightIntensity] = useState(1)
  const [lightPos1, setLightPos1] = useState({ x: 0, y: 5, z: 5 })
  const [lightPos2, setLightPos2] = useState({ x: -10, y: 0, z: 0 })
  const [lightPos3, setLightPos3] = useState({ x: 10, y: 0, z: 0 })
  const [lightPos4, setLightPos4] = useState({ x: 0, y: -5, z: -5 })
  const [showLights, setShowLights] = useState(false)

  const [uiReady, setUiReady] = useState(false)
  useEffect(() => { const id = requestAnimationFrame(() => setUiReady(true)); return () => cancelAnimationFrame(id) }, [])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches
    const narrow = typeof window !== 'undefined' && window.innerWidth < 768
    setIsMobile(uaMobile || coarse || narrow)
  }, [])

  // dynamické modely + logo
  const [files, setFiles] = useState([])
  const [colors, setColors] = useState([])
  const [opacities, setOpacities] = useState([])
  const [visibles, setVisibles] = useState([])
  const [loadedObjects, setLoadedObjects] = useState([])

  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO, opacity: 0.9, width: 160, pos: 'bc' })
  const [fatal, setFatal] = useState<string | null>(null)

  // init – manifest > files
  useEffect(() => {
    (async () => {
      try {
        const manifestUrl = getParam("manifest")
        if (manifestUrl) {
          const m = await fetchJSON(manifestUrl)
          const Fs = (m?.files || []).map((x, i) => ({ url: x.u, name: stripExt(x.n) || `Model ${i+1}` }))
          if (!Fs.length) throw new Error("Manifest je prázdný.")
          setFiles(Fs)
          const palette = ["#f5f5dc","#8e8e8e","#ffffff","#ffd7a8","#c0c0c0","#e6f0ff","#ffeedd"]
          setColors(Fs.map((_, i) => palette[i % palette.length]))
          setOpacities(Fs.map(() => 1))
          setVisibles(Fs.map(() => true))
          setLoadedObjects([])
          const logoUrl = m?.logo?.url || DEFAULT_LOGO
          setLogoCfg({
            url: logoUrl || null,
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? '0.9')),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? '120' : '160'), 10),
            pos: (getParam("logoPos") || 'bc')
          })
          return
        }

        // fallback: files param (staré linky)
        const f = getParam("files")
        if (f) {
          const arr = JSON.parse(decodeURIComponent(f))
          const Fs = arr.filter((x)=>x&&x.u).map((x,i)=>({ url:x.u, name: stripExt(x.n)||`Model ${i+1}` }))
          setFiles(Fs)
          const palette = ["#f5f5dc","#8e8e8e","#ffffff","#ffd7a8","#c0c0c0","#e6f0ff","#ffeedd"]
          setColors(Fs.map((_, i) => palette[i % palette.length]))
          setOpacities(Fs.map(() => 1))
          setVisibles(Fs.map(() => true))
          setLoadedObjects([])
          setLogoCfg({
            url: getParam("logo") === "none" ? null : (getParam("logo") || DEFAULT_LOGO),
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? '0.9')),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? '120' : '160'), 10),
            pos: (getParam("logoPos") || 'bc')
          })
          return
        }

        // lokální fallback (dev)
        const Fs = [
          { url: "/models/Upper.obj",  name: "Upper" },
          { url: "/models/Lower.obj",  name: "Lower" },
          { url: "/models/Crown21.obj", name: "Bridge" },
        ]
        setFiles(Fs)
        const palette = ["#f5f5dc","#8e8e8e","#ffffff"]
        setColors(Fs.map((_, i) => palette[i % palette.length]))
        setOpacities(Fs.map(() => 1))
        setVisibles(Fs.map(() => true))
      } catch (e) {
        setFatal("Tento náhled není dostupný (manifest/soubory nenalezeny).")
      }
    })()
  }, [])

  const handleModelLoaded = (obj) => {
    setLoadedObjects((prev) => (prev.includes(obj) ? prev : [...prev, obj]))
  }

  return (
    <div className="stage" style={{ position:'relative', width:'100vw', height:'100vh', background:'black' }}>
      <PreloadIcons />

      {/* LOGO pod scénou */}
      {logoCfg.url && (
        <img
          src={logoCfg.url}
          alt=""
          style={{
            position: 'absolute',
            bottom: (logoCfg.pos === 'bc' || logoCfg.pos === 'bl' || logoCfg.pos === 'br') ? 12 : 'auto',
            left:   (logoCfg.pos === 'bl') ? 12 : (logoCfg.pos === 'bc' ? '50%' : 'auto'),
            right:  (logoCfg.pos === 'br') ? 12 : 'auto',
            transform: logoCfg.pos === 'bc' ? 'translateX(-50%)' : 'none',
            width: logoCfg.width,
            opacity: logoCfg.opacity,
            zIndex: 0,
            pointerEvents: 'none',
            userSelect: 'none',
            filter: 'drop-shadow(0 0 1px rgba(0,0,0,.25))',
          }}
        />
      )}

      {/* Panel */}
      <div
        className="controls-panel"
        style={{
          position: 'absolute', top: 10, left: 10, zIndex: 2, color: 'white',
          fontFamily: 'sans-serif', fontSize: '14px', ['--slider-width']: '180px',
          opacity: uiReady ? 1 : 0, transition: 'opacity .12s ease',
          backdropFilter: 'blur(3px)', background: 'rgba(0,0,0,.25)',
          border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '10px 12px',
        }}
      >
        {fatal ? (
          <div style={{ color:'#ff8b8b' }}>{fatal}</div>
        ) : (
          files.map((f, i) => (
            <div className="control-row" key={i} style={{ display:'flex', alignItems:'center', gap:8, margin:'6px 0' }}>
              <div className="row-label" style={{ width: 140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }} title={f.name}>
                {f.name}:
              </div>
              <ColorSwatch color={colors[i] ?? '#ffffff'} onChange={(c) => {
                setColors((prev) => prev.map((v, idx) => (idx === i ? c : v)))
              }} ariaLabel={`${f.name} color`} />
              <input
                className="slider" type="range" min={0} max={1} step={0.01}
                value={opacities[i] ?? 1}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  setOpacities((prev) => prev.map((x, idx) => (idx === i ? v : x)))
                }}
                style={{ width: 'var(--slider-width, 180px)' }}
              />
              <button
                className={`toggle icon-btn ${visibles[i] ? 'is-on' : 'is-off'}`}
                onClick={() => setVisibles((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
                aria-label={visibles[i] ? `Hide ${f.name}` : `Show ${f.name}`}
                style={{
                  position:'relative', width:28, height:24, padding:0, display:'inline-flex',
                  alignItems:'center', justifyContent:'center', overflow:'hidden', marginLeft:4,
                  background:'transparent', border:'1px solid white', borderRadius:6, color:'white', cursor:'pointer',
                }}
              >
                <img src={ICONS.eye}    alt="" width="20" height="20" style={{ position:'absolute', inset:0, width:20, height:20, margin:'auto', opacity: visibles[i] ? 1 : 0, transition:'opacity .06s linear' }} />
                <img src={ICONS.eyeOff} alt="" width="20" height="20" style={{ position:'absolute', inset:0, width:20, height:20, margin:'auto', opacity: visibles[i] ? 0 : 1, transition:'opacity .06s linear' }} />
              </button>
            </div>
          ))
        )}

        {/* Toggle Světla */}
        {!fatal && (
          <>
            <button
              className={`toggle arrow-toggle ${showLights ? 'is-open' : 'is-closed'}`}
              onClick={() => setShowLights(!showLights)}
              aria-label="Toggle lights panel"
              style={{ marginTop: 10, display:'inline-flex', alignItems:'center', gap:8, padding:'6px 10px',
                border:'1px solid white', borderRadius:6, background:'transparent', color:'white', cursor:'pointer' }}
            >
              <span className="arrow-stack" aria-hidden style={{ position:'relative', width:16, height:16, display:'inline-block' }}>
                <img src={ICONS.arrowClosed} width="16" height="16" style={{ position:'absolute', left:0, top:0, width:16, height:16, opacity: showLights ? 0 : 1 }} loading="eager" decoding="async" alt="" />
                <img src={ICONS.arrowOpen}   width="16" height="16" style={{ position:'absolute', left:0, top:0, width:16, height:16, opacity: showLights ? 1 : 0 }} loading="eager" decoding="async" alt="" />
              </span>
              <span className="arrow-label">Světla</span>
            </button>

            {showLights && (
              <div style={{ marginTop: 8 }}>
                <div className="lights-row" style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <img src={ICONS.bulb} alt="" width="16" height="16" style={{ width:16, height:16 }} loading="eager" decoding="async" />
                  <span>Light Intensity</span>
                </div>
                <div className="axis-row" style={{ display:'flex', alignItems:'center', gap:8, margin:'4px 0' }}>
                  <span className="axis-label" aria-hidden="true" style={{ width:18, textAlign:'right', color:'#fff', opacity:.9 }}>&nbsp;</span>
                  <input className="slider" type="range" min={0} max={2} step={0.01} value={lightIntensity} onChange={(e) => setLightIntensity(parseFloat(e.target.value))} />
                </div>
                {[{ label: 'Light 1 Position', pos: lightPos1, setPos: setLightPos1 },
                  { label: 'Light 2 Position', pos: lightPos2, setPos: setLightPos2 },
                  { label: 'Light 3 Position', pos: lightPos3, setPos: setLightPos3 },
                  { label: 'Light 4 Position', pos: lightPos4, setPos: setLightPos4 }].map((light, idx) => (
                  <div key={idx} style={{ marginTop: 10 }}>
                    <div className="lights-row" style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <img src={ICONS.flashlight} alt="" width="16" height="16" style={{ width:16, height:16 }} loading="eager" decoding="async" />
                      <span>{light.label}</span>
                    </div>
                    {['x','y','z'].map((axis) => (
                      <div className="axis-row" key={axis} style={{ display:'flex', alignItems:'center', gap:8, margin:'4px 0' }}>
                        <span className="axis-label" style={{ width:18, textAlign:'right', color:'#fff', opacity:.9 }}>{axis.toUpperCase()}:</span>
                        <input
                          className="slider" type="range" min={-10} max={10} step={0.1}
                          value={light.pos[axis]}
                          onChange={(e) => light.setPos({ ...light.pos, [axis]: parseFloat(e.target.value) })}
                          style={{ flex:'0 0 var(--slider-width, 140px)', width:'var(--slider-width, 140px)' }}
                        />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* SCÉNA */}
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100] }}
        gl={{ alpha: true }}
        onCreated={({ gl }) => { gl.setClearAlpha(0) }}
        style={{ position:'absolute', inset:0, zIndex:1, background:'transparent' }}
      >
        {!fatal && (
          <>
            <ambientLight intensity={lightIntensity * 0.4} />
            <directionalLight position={[lightPos1.x, lightPos1.y, lightPos1.z]} intensity={lightIntensity * 1.5} />
            <directionalLight position={[lightPos2.x, lightPos2.y, lightPos2.z]} intensity={lightIntensity * 1.0} />
            <directionalLight position={[lightPos3.x, lightPos3.y, lightPos3.z]} intensity={lightIntensity * 1.2} />
            <directionalLight position={[lightPos4.x, lightPos4.y, lightPos4.z]} intensity={lightIntensity * 0.8} />

            <Suspense fallback={<Loader />}>
              {files.map((f, i) => (
                <Model
                  key={i}
                  url={f.url}
                  color={colors[i] ?? '#ffffff'}
                  opacity={opacities[i] ?? 1}
                  visible={visibles[i] ?? true}
                  onLoaded={setLoadedObjects.length === 0 ? undefined : (obj) => {
                    setLoadedObjects((prev) => (prev.includes(obj) ? prev : [...prev, obj]))
                  }}
                />
              ))}
            </Suspense>

            <FitCameraOnLoad
              objects={loadedObjects}
              expectedCount={Math.max(1, files.length)}
              margin={1.2}
              isMobile={isMobile}
              desktopScale={0.40}
              mobileScale={1.0}
            />

            <TouchTrackballControls />
          </>
        )}
      </Canvas>

      {/* Globální styly */}
      <style jsx global>{`
        .slider { appearance: none; width: var(--slider-width, 180px); height: 14px; background: transparent; margin: 5px 0; display: inline-block; }
        .slider::-webkit-slider-runnable-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; margin-top: -5px; }
        .slider::-moz-range-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; border: none; }
      `}</style>
    </div>
  )
}
