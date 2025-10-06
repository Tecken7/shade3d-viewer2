"use client"

import { Canvas, useThree, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { HexColorPicker, HexColorInput } from "react-colorful"
import { Html } from "@react-three/drei"
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader"

/* ---------- Ikony + preload ---------- */
const ICONS = {
  eye: "/icons/Eye.png",
  eyeOff: "/icons/Eye-off.png",
  arrowClosed: "/icons/Arrow-closed.svg",
  arrowOpen: "/icons/Arrow-open.svg",
  bulb: "/icons/Bulb.png",
  flashlight: "/icons/Flashlight.png",
}
function PreloadIcons() {
  useEffect(() => {
    Object.values(ICONS).forEach((src) => {
      const img = new Image()
      img.decoding = "async"
      img.src = src
    })
  }, [])
  return null
}

/* ---------- Helpers ---------- */
const DEFAULT_LOGO = "/Arthetic_logo.png"
const stripExt = (s) => s?.replace(/\.[^.]+$/, "") || ""
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const getParam = (name) => {
  if (typeof window === "undefined") return null
  return new URL(window.location.href).searchParams.get(name)
}
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}
function inferExt(nameOrUrl) {
  if (!nameOrUrl) return ""
  const s = nameOrUrl.split("?")[0]
  const m = s.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ""
}

/* ---------- Loader (overlay) ---------- */
function InlineLoader({ text }) {
  return (
    <Html center>
      <div
        style={{
          background: "rgba(0,0,0,0.7)",
          padding: "16px 28px",
          borderRadius: 10,
          color: "white",
          fontFamily: "sans-serif",
          fontSize: 16,
        }}
      >
        ⏳ {text || "Načítám…"}
      </div>
    </Html>
  )
}

/* ---------- AnyModel (OBJ/STL/PLY) ---------- */
function AnyModel({ name, url, color, opacity, visible, onLoaded }) {
  const [object3D, setObject3D] = useState(null)
  const [loading, setLoading] = useState(true)
  const ext = useMemo(() => inferExt(name || url), [name, url])

  const makeMaterial = () =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      transparent: opacity < 1,
      opacity,
      metalness: 0.5,
      roughness: 0.5,
      side: THREE.DoubleSide,
      depthWrite: opacity === 1,
    })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        let obj
        if (ext === "stl") {
          const geom = await new STLLoader().loadAsync(url)
          if (!geom.attributes.normal) geom.computeVertexNormals()
          obj = new THREE.Mesh(geom, makeMaterial())
        } else if (ext === "ply") {
          const geom = await new PLYLoader().loadAsync(url)
          if (!geom.attributes.normal) geom.computeVertexNormals()
          obj = new THREE.Mesh(geom, makeMaterial())
        } else {
          obj = await new OBJLoader().loadAsync(url)
          const mat = makeMaterial()
          obj.traverse((child) => {
            if (child.isMesh) child.material = mat
          })
        }
        if (!cancelled) {
          setObject3D(obj)
          setLoading(false)
          onLoaded && onLoaded(obj)
        }
      } catch (e) {
        if (!cancelled) setLoading(false)
        console.error("Model load error:", e)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ext])

  useEffect(() => {
    if (!object3D) return
    const mat = makeMaterial()
    if (object3D.isMesh) {
      object3D.material = mat
    } else {
      object3D.traverse((child) => {
        if (child.isMesh) child.material = mat
      })
    }
  }, [color, opacity, object3D])

  if (!object3D) return loading ? <InlineLoader text={`Načítám ${name || url}`} /> : null
  return visible ? <primitive object={object3D} /> : null
}

/* ---------- Trackball & target (UVNITŘ Canvas) ---------- */
function TouchTrackballControls({ target = [0, 0, 0] }) {
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
    const handleTouchMove = (e) => { e.preventDefault(); controls.handleTouchMove(e) }
    gl.domElement.addEventListener("touchstart", handleTouchStart, { passive: false })
    gl.domElement.addEventListener("touchmove", handleTouchMove, { passive: false })

    return () => {
      gl.domElement.removeEventListener("touchstart", handleTouchStart)
      gl.domElement.removeEventListener("touchmove", handleTouchMove)
      controls.dispose()
    }
  }, [camera, gl])

  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.set(target[0], target[1], target[2])
    controlsRef.current.update()
  }, [target])

  useFrame(() => {
    if (!controlsRef.current) return
    if (camera.isOrthographicCamera) {
      controlsRef.current.panSpeed = camera.zoom * 0.4
    }
    controlsRef.current.update()
  })

  return null
}

/* ---------- AutoCenter & AutoFrame (UVNITŘ Canvas) ---------- */
function AutoCenterAndFrame({
  rootRef,
  depsKey,
  setTarget,
  margin = 1.2,
  isMobile = false,
  desktopScale = 0.4,
  mobileScale = 1.0,
  centerMode = "combined",
}) {
  const { camera, size } = useThree()

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    root.updateMatrixWorld(true)
    const boxAll = new THREE.Box3().setFromObject(root)
    if (boxAll.isEmpty()) return

    const sizeAll = new THREE.Vector3()
    const centerAll = new THREE.Vector3()
    boxAll.getSize(sizeAll)
    boxAll.getCenter(centerAll)

    if (centerMode === "per") {
      root.children.forEach((child) => {
        const b = new THREE.Box3().setFromObject(child)
        if (b.isEmpty()) return
        const cWorld = new THREE.Vector3()
        b.getCenter(cWorld)
        child.position.sub(cWorld)
      })
      root.updateMatrixWorld(true)
      setTarget([0, 0, 0])
    } else if (centerMode === "combined") {
      root.position.sub(centerAll)
      root.updateMatrixWorld(true)
      setTarget([0, 0, 0])
    } else {
      setTarget([centerAll.x, centerAll.y, centerAll.z])
    }

    const after = new THREE.Box3().setFromObject(root)
    const dims = new THREE.Vector3()
    const ctr = new THREE.Vector3()
    after.getSize(dims)
    after.getCenter(ctr)

    const objW = Math.max(dims.x, 1e-6)
    const objH = Math.max(dims.y, 1e-6)
    const zoomX = size.width / (objW * margin)
    const zoomY = size.height / (objH * margin)
    let newZoom = Math.min(zoomX, zoomY)
    newZoom *= isMobile ? mobileScale : desktopScale

    camera.near = -1_000_000
    camera.far = 1_000_000
    camera.zoom = Math.max(newZoom, 0.01)
    camera.position.set(ctr.x, ctr.y, ctr.z + Math.abs(camera.position.z))
    camera.updateProjectionMatrix()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, size.width, size.height, isMobile, desktopScale, mobileScale, margin, centerMode])

  return null
}

/* ---------- Color popover (UI) ---------- */
function ColorSwatch({ color, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  useEffect(() => {
    const onDocClick = (e) => { if (open && containerRef.current && !containerRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [open])
  return (
    <div ref={containerRef} className="swatch-wrap" style={{ position: "relative", display: "inline-block" }}>
      <button
        aria-label={ariaLabel || "color picker"}
        onClick={() => setOpen((v) => !v)}
        className="swatch-btn"
        style={{
          width: 36, height: 22, borderRadius: 4, border: "1px solid #fff",
          background: color, cursor: "pointer", boxShadow: "0 0 0 1px rgba(0,0,0,.25) inset",
        }}
      />
      {open && (
        <div
          className="swatch-pop"
          style={{
            position: "absolute", zIndex: 20, top: 28, left: 0,
            background: "rgba(0,0,0,.92)", padding: 12, borderRadius: 10,
            border: "1px solid rgba(255,255,255,.18)", backdropFilter: "blur(4px)",
            boxShadow: "0 6px 24px rgba(0,0,0,.35)",
          }}
        >
          <HexColorPicker color={color} onChange={onChange} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ color: "#fff", fontSize: 12 }}>#</span>
            <HexColorInput
              color={color}
              onChange={onChange}
              prefixed={false}
              style={{
                width: 90, padding: "4px 6px", borderRadius: 6,
                border: "1px solid #444", background: "#111", color: "#fff",
                fontFamily: "monospace", fontSize: 12,
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- ClientPage ---------- */
export default function ClientPage() {
  // světla
  const [lightIntensity, setLightIntensity] = useState(1)
  const [lightPos1, setLightPos1] = useState({ x: 0, y: 5, z: 5 })
  const [lightPos2, setLightPos2] = useState({ x: -10, y: 0, z: 0 })
  const [lightPos3, setLightPos3] = useState({ x: 10, y: 0, z: 0 })
  const [lightPos4, setLightPos4] = useState({ x: 0, y: -5, z: -5 })
  const [showLights, setShowLights] = useState(false)

  const [uiReady, setUiReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setUiReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    const coarse = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches
    const narrow = typeof window !== "undefined" && window.innerWidth < 768
    setIsMobile(uaMobile || coarse || narrow)
  }, [])

  // data modelů + logo
  const [files, setFiles] = useState([])
  const [colors, setColors] = useState([])
  const [opacities, setOpacities] = useState([])
  const [visibles, setVisibles] = useState([])
  const [fatal, setFatal] = useState(null)

  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO, opacity: 0.9, width: 160, pos: "bc" })

  // Trackball target
  const [cameraTarget, setCameraTarget] = useState([0, 0, 0])

  // načtené objekty count (trigger centra/fitu)
  const [loadedCount, setLoadedCount] = useState(0)
  const handleModelLoaded = () => setLoadedCount((n) => n + 1)

  // parametr centrování
  const centerParam = (getParam("center") || "combined").toLowerCase()
  const centerMode = ["per", "combined", "none"].includes(centerParam) ? centerParam : "combined"

  // init – manifest > files
  useEffect(() => {
    ;(async () => {
      try {
        const manifestUrl = getParam("manifest")
        if (manifestUrl) {
          const m = await fetchJSON(manifestUrl)
          const Fs = (m?.files || []).map((x, i) => ({
            url: x.u,
            name: stripExt(x.n) || `Model ${i + 1}`,
            rawName: x.n,
          }))
          if (!Fs.length) throw new Error("Manifest je prázdný.")
          setFiles(Fs)
          const palette = ["#f5f5dc", "#8e8e8e", "#ffffff", "#ffd7a8", "#c0c0c0", "#e6f0ff", "#ffeedd"]
          setColors(Fs.map((_, i) => palette[i % palette.length]))
          setOpacities(Fs.map(() => 1))
          setVisibles(Fs.map(() => true))
          const logoUrl = m?.logo?.url || DEFAULT_LOGO
          setLogoCfg({
            url: logoUrl || null,
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10),
            pos: getParam("logoPos") || "bc",
          })
          return
        }

        const f = getParam("files")
        if (f) {
          const arr = JSON.parse(decodeURIComponent(f))
          const Fs = arr
            .filter((x) => x && x.u)
            .map((x, i) => ({ url: x.u, name: stripExt(x.n) || `Model ${i + 1}`, rawName: x.n }))
          setFiles(Fs)
          const palette = ["#f5f5dc", "#8e8e8e", "#ffffff", "#ffd7a8", "#c0c0c0", "#e6f0ff", "#ffeedd"]
          setColors(Fs.map((_, i) => palette[i % palette.length]))
          setOpacities(Fs.map(() => 1))
          setVisibles(Fs.map(() => true))
          setLogoCfg({
            url: getParam("logo") === "none" ? null : getParam("logo") || DEFAULT_LOGO,
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10),
            pos: getParam("logoPos") || "bc",
          })
          return
        }

        // dev fallback
        const Fs = [
          { url: "/models/Upper.obj", name: "Upper", rawName: "Upper.obj" },
          { url: "/models/Lower.stl", name: "Lower", rawName: "Lower.stl" },
          { url: "/models/Crown21.ply", name: "Bridge", rawName: "Crown21.ply" },
        ]
        setFiles(Fs)
        const palette = ["#f5f5dc", "#8e8e8e", "#ffffff"]
        setColors(Fs.map((_, i) => palette[i % palette.length]))
        setOpacities(Fs.map(() => 1))
        setVisibles(Fs.map(() => true))
      } catch (e) {
        setFatal("Tento náhled není dostupný (manifest/soubory nenalezeny).")
      }
    })()
  }, [])

  // LOGO pod scénou
  const logoEl = logoCfg.url && (
    <img
      src={logoCfg.url}
      alt=""
      style={{
        position: "absolute",
        bottom: logoCfg.pos === "bc" || logoCfg.pos === "bl" || logoCfg.pos === "br" ? 12 : "auto",
        left: logoCfg.pos === "bl" ? 12 : logoCfg.pos === "bc" ? "50%" : "auto",
        right: logoCfg.pos === "br" ? 12 : "auto",
        transform: logoCfg.pos === "bc" ? "translateX(-50%)" : "none",
        width: logoCfg.width,
        opacity: logoCfg.opacity,
        zIndex: 0,
        pointerEvents: "none",
        userSelect: "none",
        filter: "drop-shadow(0 0 1px rgba(0,0,0,.25))",
      }}
    />
  )

  // ref na root group v Canvasu
  const rootRef = useRef()

  return (
    <div className="stage" style={{ position: "relative", width: "100vw", height: "100vh", background: "black" }}>
      <PreloadIcons />

      {/* LOGO pod scénou */}
      {logoEl}

      {/* Ovládací panel */}
      <div
        className="controls-panel"
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 2,
          color: "white",
          fontFamily: "sans-serif",
          fontSize: "14px",
          opacity: uiReady ? 1 : 0,
          transition: "opacity .12s ease",
          backdropFilter: "blur(3px)",
          background: "rgba(0,0,0,.25)",
          border: "1px solid rgba(255,255,255,.15)",
          borderRadius: 8,
          padding: "10px 12px",
          width: "clamp(260px, 38vw, 560px)",
          maxWidth: "calc(100vw - 20px)",
          boxSizing: "border-box",
        }}
      >
        {fatal ? (
          <div style={{ color: "#ff8b8b" }}>{fatal}</div>
        ) : (
          files.map((f, i) => (
            <div
              className="control-row"
              key={i}
              style={{
                display: "grid",
                gridTemplateColumns: "max-content 1fr 28px", // label | control | eye
                alignItems: "center",
                columnGap: 8,
                rowGap: 6,
                margin: "8px 0",
              }}
            >
              {/* Label (šířka = text) */}
              <div
                className="row-label"
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={f.rawName || f.name}
              >
                {stripExt(f.name)}:
              </div>

              {/* Control area: slider (100%) + swatch přilepený vlevo */}
              <div
                className="row-control"
                style={{
                  position: "relative",
                  minWidth: 0,
                }}
              >
                {/* slider – plynule, ale s minimální délkou pro použitelnost */}
                <input
                  className="slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={opacities[i] ?? 1}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value)
                    setOpacities((prev) => prev.map((x, idx) => (idx === i ? v : x)))
                  }}
                  style={{
                    width: "100%",
                    minWidth: 140, // ← minimální délka, aby šel pohodlně ovládat
                  }}
                />

                {/* swatch překrývá levý začátek dráhy → slider vizuálně "začíná" hned za názvem */}
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "auto",
                  }}
                >
                  <ColorSwatch
                    color={colors[i] ?? "#ffffff"}
                    onChange={(c) => setColors((prev) => prev.map((v, idx) => (idx === i ? c : v)))}
                    ariaLabel={`${f.name} color`}
                  />
                </div>

                {/* aby slider nebyl pod swatchem nekliknutelný, posuň jeho „klikací“ začátek pod swatchem doprava paddingem na wrapperu */}
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 44, // 36 swatch + 8px vizuální mezera
                    pointerEvents: "none",
                    background: "transparent",
                  }}
                />
                {/* vizuálně to nechává slider podjet pod swatch, ale uživatel tahá za palec bez kolize */}
              </div>

              {/* Eye button */}
              <button
                className={`toggle icon-btn ${visibles[i] ? "is-on" : "is-off"}`}
                onClick={() => setVisibles((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
                aria-label={visibles[i] ? `Hide ${f.name}` : `Show ${f.name}`}
                style={{
                  position: "relative",
                  width: 28,
                  height: 24,
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                  background: "transparent",
                  border: "1px solid white",
                  borderRadius: 6,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <img
                  src={ICONS.eye}
                  alt=""
                  width="20"
                  height="20"
                  style={{ position: "absolute", inset: 0, width: 20, height: 20, margin: "auto", opacity: visibles[i] ? 1 : 0, transition: "opacity .06s linear" }}
                />
                <img
                  src={ICONS.eyeOff}
                  alt=""
                  width="20"
                  height="20"
                  style={{ position: "absolute", inset: 0, width: 20, height: 20, margin: "auto", opacity: visibles[i] ? 0 : 1, transition: "opacity .06s linear" }}
                />
              </button>
            </div>
          ))
        )}

        {/* Toggle Světla */}
        {!fatal && (
          <>
            <button
              className={`toggle arrow-toggle ${showLights ? "is-open" : "is-closed"}`}
              onClick={() => setShowLights(!showLights)}
              aria-label="Toggle lights panel"
              style={{
                marginTop: 10,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                border: "1px solid white",
                borderRadius: 6,
                background: "transparent",
                color: "white",
                cursor: "pointer",
              }}
            >
              <span className="arrow-stack" aria-hidden style={{ position: "relative", width: 16, height: 16, display: "inline-block" }}>
                <img src={ICONS.arrowClosed} width="16" height="16" style={{ position: "absolute", left: 0, top: 0, opacity: showLights ? 0 : 1 }} alt="" />
                <img src={ICONS.arrowOpen} width="16" height="16" style={{ position: "absolute", left: 0, top: 0, opacity: showLights ? 1 : 0 }} alt="" />
              </span>
              <span className="arrow-label">Světla</span>
            </button>

            {showLights && (
              <div className="lights-wrap" style={{ marginTop: 8 }}>
                <div className="lights-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <img src={ICONS.bulb} alt="" width="16" height="16" style={{ width: 16, height: 16 }} />
                  <span>Light Intensity</span>
                </div>
                <div className="axis-row" style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                  <span className="axis-label" aria-hidden="true" style={{ width: 18, textAlign: "right", color: "#fff", opacity: 0.9 }}>&nbsp;</span>
                  <input className="slider" type="range" min={0} max={2} step={0.01} value={lightIntensity} onChange={(e) => setLightIntensity(parseFloat(e.target.value))} style={{ flex: "1 1 auto", width: "100%", minWidth: 140 }}/>
                </div>
                {[
                  { label: "Light 1 Position", pos: lightPos1, setPos: setLightPos1 },
                  { label: "Light 2 Position", pos: lightPos2, setPos: setLightPos2 },
                  { label: "Light 3 Position", pos: lightPos3, setPos: setLightPos3 },
                  { label: "Light 4 Position", pos: lightPos4, setPos: setLightPos4 },
                ].map((light, idx) => (
                  <div key={idx} className="light-block" style={{ marginTop: 10 }}>
                    <div className="lights-row" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <img src={ICONS.flashlight} alt="" width="16" height="16" style={{ width: 16, height: 16 }} />
                      <span>{light.label}</span>
                    </div>
                    {["x", "y", "z"].map((axis) => (
                      <div className="axis-row" key={axis} style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0" }}>
                        <span className="axis-label" style={{ width: 18, textAlign: "right", color: "#fff", opacity: 0.9 }}>{axis.toUpperCase()}:</span>
                        <input
                          className="slider"
                          type="range"
                          min={-10}
                          max={10}
                          step={0.1}
                          value={light.pos[axis]}
                          onChange={(e) => light.setPos({ ...light.pos, [axis]: parseFloat(e.target.value) })}
                          style={{ flex: "1 1 auto", width: "100%", minWidth: 140 }}
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

      {/* CANVAS */}
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], near: -100000, far: 100000 }}
        gl={{ alpha: true }}
        onCreated={({ gl }) => gl.setClearAlpha(0)}
        style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent" }}
      >
        {!fatal && (
          <>
            <ambientLight intensity={lightIntensity * 0.4} />
            <directionalLight position={[lightPos1.x, lightPos1.y, lightPos1.z]} intensity={lightIntensity * 1.5} />
            <directionalLight position={[lightPos2.x, lightPos2.y, lightPos2.z]} intensity={lightIntensity * 1.0} />
            <directionalLight position={[lightPos3.x, lightPos3.y, lightPos3.z]} intensity={lightIntensity * 1.2} />
            <directionalLight position={[lightPos4.x, lightPos4.y, lightPos4.z]} intensity={lightIntensity * 0.8} />

            <group ref={rootRef}>
              <Suspense fallback={null}>
                {files.map((f, i) => (
                  <AnyModel
                    key={i}
                    name={f.rawName || f.name}
                    url={f.url}
                    color={colors[i] ?? "#ffffff"}
                    opacity={opacities[i] ?? 1}
                    visible={visibles[i] ?? true}
                    onLoaded={handleModelLoaded}
                  />
                ))}
              </Suspense>
            </group>

            {/* Auto-center/fit + Trackball (uvnitř Canvas) */}
            <AutoCenterAndFrame
              rootRef={rootRef}
              depsKey={loadedCount === files.length ? `ready-${files.length}` : `loading-${loadedCount}`}
              setTarget={setCameraTarget}
              margin={1.2}
              isMobile={isMobile}
              desktopScale={0.4}
              mobileScale={1.0}
              centerMode={centerMode}
            />
            <TouchTrackballControls target={cameraTarget} />
          </>
        )}
      </Canvas>

      {/* Globální styly sliderů + responzivní layout panelu */}
      <style jsx global>{`
        .slider { appearance: none; height: 14px; background: transparent; margin: 5px 0; display: inline-block; }
        .slider::-webkit-slider-runnable-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; margin-top: -5px; }
        .slider::-moz-range-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; border: none; }

        /* --- RESPONSIVE --- */
        @media (max-width: 720px) {
          .controls-panel {
            left: 8px !important;
            right: 8px;
            width: auto !important;
            max-width: calc(100vw - 16px) !important;
          }
          .control-row {
            grid-template-columns: 1fr 28px !important; /* control | eye */
          }
          .control-row .row-label {
            grid-column: 1 / -1;  /* label přes celý řádek */
            white-space: normal !important;
            word-break: break-word;
            opacity: .95;
          }
          .row-control .slider { width: 100% !important; min-width: 140px !important; }
        }
      `}</style>
    </div>
  )
}
