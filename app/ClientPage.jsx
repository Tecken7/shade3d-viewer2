"use client"

import { Canvas, useThree, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { HexColorPicker, HexColorInput } from "react-colorful"
import { Html } from "@react-three/drei"
import { TrackballControls, OBJLoader, STLLoader, PLYLoader, RGBELoader } from "three-stdlib"

/* ---------------- Error boundary ---------------- */
function ErrorBoundary({ children }) {
  const [err, setErr] = useState(null)
  if (err) {
    return (
      <div style={{ position: "absolute", inset: 0, background: "black", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ position: "absolute", top: 10, left: 10, background: "rgba(145,44,44,.25)", border: "1px solid #a55",
          borderRadius: 8, padding: "10px 12px", maxWidth: 520 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Viewer error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{String(err)}</div>
        </div>
      </div>
    )
  }
  return <ErrorCatcher onError={setErr}>{children}</ErrorCatcher>
}
function ErrorCatcher({ onError, children }) {
  useEffect(() => {
    const h = (e) => { onError?.(e?.reason ?? e?.error ?? e?.message ?? "Unknown error") }
    window.addEventListener("error", h)
    window.addEventListener("unhandledrejection", h)
    return () => {
      window.removeEventListener("error", h)
      window.removeEventListener("unhandledrejection", h)
    }
  }, [onError])
  return children
}

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
    Object.values(ICONS).forEach((src) => { const img = new Image(); img.decoding = "async"; img.src = src })
  }, [])
  return null
}

/* ---------- Helpers ---------- */
const DEFAULT_LOGO = "/Arthetic_logo.png"
const stripExt = (s) => s?.replace(/\.[^.]+$/, "") || ""
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const getParam = (name) => (typeof window === "undefined") ? null : new URL(window.location.href).searchParams.get(name)
async function fetchJSON(url) { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status} – ${url}`); return r.json() }
function inferExt(nameOrUrl) { if (!nameOrUrl) return ""; const s = nameOrUrl.split("?")[0]; const m = s.match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : "" }

/* ---------- Auto Smooth ---------- */
function autoSmoothGeometry(geometry, angleDeg = 30) {
  const angle = Math.max(0, Math.min(89.9, angleDeg)), angleRad = (angle * Math.PI) / 180
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const pos = g.getAttribute("position"), vCount = pos.count, triCount = vCount / 3
  const faceNormals = new Array(triCount)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const cb = new THREE.Vector3(), ab = new THREE.Vector3()
  for (let f = 0; f < triCount; f++) {
    const i0 = f * 3, i1 = i0 + 1, i2 = i0 + 2
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2)
    cb.subVectors(c, b); ab.subVectors(a, b); cb.cross(ab).normalize(); faceNormals[f] = cb.clone()
  }
  const groups = new Map()
  const keyOf = (ix) => `${pos.getX(ix).toFixed(5)},${pos.getY(ix).toFixed(5)},${pos.getZ(ix).toFixed(5)}`
  for (let i = 0; i < vCount; i++) { const k = keyOf(i); let arr = groups.get(k); if (!arr) { arr = []; groups.set(k, arr) } arr.push(i) }
  const normals = new Float32Array(vCount * 3), tmp = new THREE.Vector3(), cosThresh = Math.cos(angleRad)
  groups.forEach((cornerIndices) => {
    const localFaceNs = cornerIndices.map((ci) => faceNormals[Math.floor(ci / 3)])
    for (let idx = 0; idx < cornerIndices.length; idx++) {
      const ci = cornerIndices[idx], nRef = localFaceNs[idx]; let nx = 0, ny = 0, nz = 0
      for (let j = 0; j < localFaceNs.length; j++) { const nj = localFaceNs[j]; if (nRef.dot(nj) >= cosThresh) { nx += nj.x; ny += nj.y; nz += nj.z } }
      tmp.set(nx, ny, nz); if (tmp.lengthSq() === 0) tmp.copy(nRef); tmp.normalize()
      const w = ci * 3; normals[w] = tmp.x; normals[w + 1] = tmp.y; normals[w + 2] = tmp.z
    }
  })
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3)); g.computeBoundingBox(); g.computeBoundingSphere(); return g
}

/* ---------- Loader (overlay) ---------- */
function InlineLoader({ text }) {
  return (
    <Html center>
      <div style={{ background: "rgba(0,0,0,0.7)", padding: "16px 28px", borderRadius: 10, color: "white", fontFamily: "sans-serif", fontSize: 16 }}>
        ⏳ {text || "Načítám…"}
      </div>
    </Html>
  )
}

/* ---------- AnyModel ---------- */
// (beze změn – ponechávám tvoji poslední verzi)
function AnyModel({ name, url, color, opacity, visible, onLoaded, autoSmooth, smoothAngle, roughness = 0.5, metalness = 0.5, useVertexColors = false, keepMaterials = false }) {
  const [object3D, setObject3D] = useState(null)
  const [loading, setLoading] = useState(true)
  const ext = useMemo(() => inferExt(name || url), [name, url])
  const makeMat = (opts = {}) => new THREE.MeshStandardMaterial({
    color: new THREE.Color(color || "#ffffff"),
    roughness: typeof roughness === "number" ? roughness : 0.5,
    metalness: typeof metalness === "number" ? metalness : 0.5,
    transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity === 1, ...opts,
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
          const base = autoSmooth ? autoSmoothGeometry(geom, smoothAngle) : (geom.computeVertexNormals(), geom)
          const mat = makeMat(); obj = new THREE.Mesh(base, mat)
          obj.userData._baseGeom = geom; obj.userData._derivedGeom = base
        } else if (ext === "ply") {
          const geom = await new PLYLoader().loadAsync(url)
          const hasVC = !!geom.getAttribute("color")
          let base = geom
          if (autoSmooth) base = autoSmoothGeometry(geom, smoothAngle)
          else if (!geom.attributes.normal) geom.computeVertexNormals()
          const mat = hasVC && useVertexColors ? makeMat({ vertexColors: true, color: new THREE.Color("#ffffff") }) : makeMat()
          obj = new THREE.Mesh(base, mat); obj.userData._baseGeom = geom; obj.userData._derivedGeom = base
        } else {
          const loaded = await new OBJLoader().loadAsync(url)
          if (keepMaterials) {
            loaded.traverse((child) => {
              if (child.isMesh) {
                const mat = child.material
                if (mat) {
                  if ("transparent" in mat) mat.transparent = opacity < 1
                  if ("opacity" in mat) mat.opacity = opacity
                  if ("roughness" in mat && typeof roughness === "number") mat.roughness = roughness
                  if ("metalness" in mat && typeof metalness === "number") mat.metalness = metalness
                }
              }
            })
            obj = loaded
          } else {
            const mat = makeMat()
            loaded.traverse((child) => { if (child.isMesh) child.material = mat })
            obj = loaded
          }
        }
        if (!cancelled) { setObject3D(obj); setLoading(false); onLoaded && onLoaded(obj) }
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
    object3D.traverse((child) => {
      if (!child.isMesh) return
      if (!child.userData._baseGeom) child.userData._baseGeom = child.geometry
      const base = child.userData._baseGeom
      let newGeom = base
      if (autoSmooth) newGeom = autoSmoothGeometry(base, smoothAngle)
      else { newGeom = base.clone(); newGeom.computeVertexNormals() }
      if (child.userData._derivedGeom && child.userData._derivedGeom !== base) child.userData._derivedGeom.dispose()
      child.geometry = newGeom; child.userData._derivedGeom = newGeom
    })
  }, [object3D, autoSmooth, smoothAngle])

  useEffect(() => {
    if (!object3D) return
    object3D.traverse((child) => {
      if (!child.isMesh) return
      if (keepMaterials) {
        const mat = child.material
        if (mat) {
          if ("transparent" in mat) mat.transparent = opacity < 1
          if ("opacity" in mat) mat.opacity = opacity
          if ("roughness" in mat && typeof roughness === "number") mat.roughness = roughness
          if ("metalness" in mat && typeof metalness === "number") mat.metalness = metalness
          if (!useVertexColors && "color" in mat && color) mat.color = new THREE.Color(color)
          if (useVertexColors && "vertexColors" in mat) { mat.vertexColors = true; if ("color" in mat) mat.color = new THREE.Color("#ffffff") }
          mat.needsUpdate = true
        }
      } else {
        const hasVC = !!child.geometry.getAttribute?.("color")
        const mat = hasVC && useVertexColors ? makeMat({ vertexColors: true, color: new THREE.Color("#ffffff") }) : makeMat()
        child.material = mat
      }
    })
  }, [object3D, color, opacity, roughness, metalness, useVertexColors, keepMaterials])

  if (!object3D) return loading ? <InlineLoader text={`Načítám ${name || url}`} /> : null
  return visible ? <primitive object={object3D} /> : null
}

/* ---------- Trackball ---------- */
function TouchTrackballControls({ target = [0, 0, 0] }) {
  const { camera, gl } = useThree()
  const controlsRef = useRef(null)
  useEffect(() => {
    const controls = new TrackballControls(camera, gl.domElement)
    controls.rotateSpeed = 5.0; controls.zoomSpeed = 1.2; controls.panSpeed = 1.0; controls.staticMoving = true
    controlsRef.current = controls
    const ts = (e) => { e.preventDefault(); controls.handleTouchStart(e) }
    const tm = (e) => { e.preventDefault(); controls.handleTouchMove(e) }
    gl.domElement.addEventListener("touchstart", ts, { passive: false })
    gl.domElement.addEventListener("touchmove", tm, { passive: false })
    return () => { gl.domElement.removeEventListener("touchstart", ts); gl.domElement.removeEventListener("touchmove", tm); controls.dispose() }
  }, [camera, gl])
  useEffect(() => { if (!controlsRef.current) return; controlsRef.current.target.set(target[0], target[1], target[2]); controlsRef.current.update() }, [target])
  useFrame(() => { if (!controlsRef.current) return; if (camera.isOrthographicCamera) controlsRef.current.panSpeed = camera.zoom * 0.4; controlsRef.current.update() })
  return null
}

/* ---------- AutoCenter & AutoFrame ---------- */
function AutoCenterAndFrame({ rootRef, depsKey, setTarget, margin = 1.2, isMobile = false, desktopScale = 0.4, mobileScale = 1.0, centerMode = "combined" }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const root = rootRef.current; if (!root) return
    root.updateMatrixWorld(true)
    const boxAll = new THREE.Box3().setFromObject(root); if (boxAll.isEmpty()) return
    const centerAll = new THREE.Vector3(), dims = new THREE.Vector3(); boxAll.getCenter(centerAll); boxAll.getSize(dims)
    if (centerMode === "per") {
      root.children.forEach((child) => { const b = new THREE.Box3().setFromObject(child); if (b.isEmpty()) return; const cWorld = new THREE.Vector3(); b.getCenter(cWorld); child.position.sub(cWorld) })
      root.updateMatrixWorld(true); setTarget([0, 0, 0])
    } else if (centerMode === "combined") {
      root.position.sub(centerAll); root.updateMatrixWorld(true); setTarget([0, 0, 0])
    } else { setTarget([centerAll.x, centerAll.y, centerAll.z]) }
    const after = new THREE.Box3().setFromObject(root), dims2 = new THREE.Vector3(), ctr = new THREE.Vector3()
    after.getSize(dims2); after.getCenter(ctr)
    const objW = Math.max(dims2.x, 1e-6), objH = Math.max(dims2.y, 1e-6)
    const zoomX = size.width / (objW * margin), zoomY = size.height / (objH * margin)
    let newZoom = Math.min(zoomX, zoomY); newZoom *= isMobile ? mobileScale : desktopScale
    camera.near = 0.01; camera.far = 100000; camera.zoom = Math.max(newZoom, 0.01)
    camera.position.set(ctr.x, ctr.y, ctr.z + Math.abs(camera.position.z)); camera.updateProjectionMatrix()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, size.width, size.height, isMobile, desktopScale, mobileScale, margin, centerMode])
  return null
}

/* ---------- EnvLoader (HDRI prostředí) ---------- */
function EnvLoader({ hdriUrl, envTexRef, onError }) {
  const { scene, gl } = useThree()
  useEffect(() => {
    let disposed = false
    let pmrem = null
    let hdrTex = null

    async function load() {
      try {
        // vypnout environment při „none“
        if (!hdriUrl) {
          if (envTexRef.current) { envTexRef.current.dispose?.(); envTexRef.current = null }
          scene.environment = null
          return
        }

        const loader = new RGBELoader()
          .setDataType(THREE.UnsignedByteType)
          .setCrossOrigin("anonymous")

        hdrTex = await loader.loadAsync(hdriUrl)
        if (disposed) return
        if (!hdrTex || !hdrTex.image) {
          throw new Error("HDR decode failed (no image data)")
        }

        // pro jistotu – tři si to vyřeší přes PMREM, ale mapping nevadí
        hdrTex.mapping = THREE.EquirectangularReflectionMapping

        pmrem = new THREE.PMREMGenerator(gl)
        pmrem.compileEquirectangularShader()

        const { texture: env } = pmrem.fromEquirectangular(hdrTex)
        // uklid
        hdrTex.dispose(); hdrTex = null
        pmrem.dispose(); pmrem = null

        if (disposed) { env.dispose?.(); return }

        if (envTexRef.current && envTexRef.current !== env) {
          envTexRef.current.dispose?.()
        }
        envTexRef.current = env
        scene.environment = env
      } catch (e) {
        console.error("HDRI load error:", e)
        onError?.("HDRI load error: " + (e?.message || e))
        // fallback
        scene.environment = null
        if (envTexRef.current) { envTexRef.current.dispose?.(); envTexRef.current = null }
      } finally {
        if (pmrem) pmrem.dispose()
        if (hdrTex) hdrTex.dispose()
      }
    }

    load()
    return () => {
      disposed = true
    }
  }, [hdriUrl, scene, gl, envTexRef, onError])
  return null
}

/* ---------- HDRI presets ---------- */
const HDRI_PRESETS = {
  none: null,
  studioSoft: "/hdr/studio_small_03_1k.hdr",
}

/* -------------------- ClientPage (Viewer) -------------------- */
export default function ClientPage() {
  // ……………………… (tvoje poslední logika stavů a initu – beze změn)
  // kvůli stručnosti nechávám jen podstatné odlišnosti:

  const [lightIntensity, setLightIntensity] = useState(1)
  const [lightPos1, setLightPos1] = useState({ x: 0, y: 5, z: 5 })
  const [lightPos2, setLightPos2] = useState({ x: -10, y: 0, z: 0 })
  const [lightPos3, setLightPos3] = useState({ x: 10, y: 0, z: 0 })
  const [lightPos4, setLightPos4] = useState({ x: 0, y: -5, z: -5 })
  const [showLights, setShowLights] = useState(false)
  const [uiReady, setUiReady] = useState(false); useEffect(() => { const id = requestAnimationFrame(() => setUiReady(true)); return () => cancelAnimationFrame(id) }, [])
  const [isMobile, setIsMobile] = useState(false); useEffect(() => { const uaMobile=/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent); const coarse=window.matchMedia?.("(pointer: coarse)")?.matches; const narrow=typeof window!=="undefined"&&window.innerWidth<768; setIsMobile(uaMobile||coarse||narrow) }, [])
  const [title, setTitle] = useState(null)

  const [files, setFiles] = useState([]), [colors, setColors] = useState([]), [opacities, setOpacities] = useState([]), [visibles, setVisibles] = useState([])
  const [roughnesses, setRoughnesses] = useState([]), [metalnesses, setMetalnesses] = useState([])
  const [fatal, setFatal] = useState(null)

  const [autoSmooth, setAutoSmooth] = useState((getParam("smooth") ?? "1") !== "0")
  const [smoothAngle, setSmoothAngle] = useState(() => { const v = parseFloat(getParam("smoothAngle") ?? "30"); return isFinite(v) ? Math.max(0, Math.min(80, v)) : 30 })

  // startujeme bez prostředí – uživatel ho může zapnout, nebo ?env=
  const [hdriKey, setHdriKey] = useState(() => {
    const k = getParam("env")
    return HDRI_PRESETS[k] !== undefined ? k : "none"
  })
  const envTexRef = useRef(null)

  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO, opacity: 0.9, width: 160, pos: "bc" })
  const [cameraTarget, setCameraTarget] = useState([0, 0, 0])
  const [loadedCount, setLoadedCount] = useState(0)
  const handleModelLoaded = () => setLoadedCount((n) => n + 1)
  const centerParam = (getParam("center") || "combined").toLowerCase()
  const centerMode = ["per", "combined", "none"].includes(centerParam) ? centerParam : "combined"

  // -------- init (tvoje původní logika načtení manifestu / files z URL) --------
  useEffect(() => {
    ;(async () => {
      try {
        const manifestUrl = getParam("manifest")
        if (manifestUrl) {
          const m = await fetchJSON(manifestUrl)
          const Fs = (m?.files || []).map((x, i) => ({
            url: x.u, name: stripExt(x.n) || `Model ${i + 1}`, rawName: x.n,
            c: x.c, o: typeof x.o === "number" ? x.o : 1,
            v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? x.r : 0.5,
            m: typeof x.m === "number" ? x.m : 0.5,
            vc: !!x.vc, km: !!x.km,
          }))
          if (!Fs.length) throw new Error("Manifest je prázdný.")
          setFiles(Fs)
          const palette = ["#f5f5dc", "#8e8e8e", "#ffffff", "#ffd7a8", "#c0c0c0", "#e6f0ff", "#ffeedd"]
          setColors(Fs.map((f, i) => f.c || palette[i % palette.length]))
          setOpacities(Fs.map((f) => (typeof f.o === "number" ? clamp01(f.o) : 1)))
          setVisibles(Fs.map((f) => (typeof f.v === "boolean" ? f.v : true)))
          setRoughnesses(Fs.map((f) => (typeof f.r === "number" ? clamp01(f.r) : 0.5)))
          setMetalnesses(Fs.map((f) => (typeof f.m === "number" ? clamp01(f.m) : 0.5)))
          setTitle(typeof m?.title === "string" ? m.title : (getParam("title") ?? null))
          const envKey = (m?.env && HDRI_PRESETS[m.env] !== undefined) ? m.env : (getParam("env") || hdriKey)
          if (HDRI_PRESETS[envKey] !== undefined) setHdriKey(envKey)
          const logoUrl = m?.logo?.url || DEFAULT_LOGO
          setLogoCfg({ url: logoUrl || null, opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10), pos: getParam("logoPos") || "bc" })
          return
        }
        const f = getParam("files")
        if (f) {
          let arr = null; try { arr = JSON.parse(f) } catch {}
          if (!arr) { try { arr = JSON.parse(decodeURIComponent(f)) } catch {} }
          if (!Array.isArray(arr)) throw new Error("Neplatný formát ?files=")
          const Fs = arr.filter((x) => x && x.u).map((x, i) => ({
            url: x.u, name: stripExt(x.n) || `Model ${i + 1}`, rawName: x.n,
            c: x.c, o: typeof x.o === "number" ? x.o : 1,
            v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? x.r : 0.5,
            m: typeof x.m === "number" ? x.m : 0.5,
            vc: !!x.vc, km: !!x.km,
          }))
          setFiles(Fs)
          const palette = ["#f5f5dc", "#8e8e8e", "#ffffff", "#ffd7a8", "#c0c0c0", "#e6f0ff", "#ffeedd"]
          setColors(Fs.map((f, i) => f.c || palette[i % palette.length]))
          setOpacities(Fs.map((f) => (typeof f.o === "number" ? clamp01(f.o) : 1)))
          setVisibles(Fs.map((f) => (typeof f.v === "boolean" ? f.v : true)))
          setRoughnesses(Fs.map((f) => (typeof f.r === "number" ? clamp01(f.r) : 0.5)))
          setMetalnesses(Fs.map((f) => (typeof f.m === "number" ? clamp01(f.m) : 0.5)))
          setTitle(getParam("title") ?? null)
          const envKey = getParam("env"); if (envKey && HDRI_PRESETS[envKey] !== undefined) setHdriKey(envKey)
          setLogoCfg({ url: getParam("logo") === "none" ? null : getParam("logo") || DEFAULT_LOGO,
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10),
            pos: getParam("logoPos") || "bc" })
          return
        }
        // dev fallback
        const Fs = [
          { url: "/models/Upper.obj", name: "Upper", rawName: "Upper.obj", r: 0.5, m: 0.5, v: true, vc: false, km: false },
          { url: "/models/Lower.stl", name: "Lower", rawName: "Lower.stl", r: 0.5, m: 0.5, v: true, vc: false, km: false },
          { url: "/models/Crown21.ply", name: "Bridge", rawName: "Crown21.ply", r: 0.5, m: 0.5, v: true, vc: false, km: false },
        ]
        setFiles(Fs)
        const palette = ["#f5f5dc", "#8e8e8e", "#ffffff"]
        setColors(Fs.map((_, i) => palette[i % palette.length])); setOpacities(Fs.map(() => 1))
        setVisibles(Fs.map((f) => f.v)); setRoughnesses(Fs.map((f) => f.r)); setMetalnesses(Fs.map((f) => f.m))
      } catch (e) {
        console.error(e); setFatal("Tento náhled není dostupný (chyba při načtení dat).")
      }
    })()
  }, [])

  const logoEl = logoCfg.url && (
    <img src={logoCfg.url} alt="" style={{
      position: "absolute",
      bottom: logoCfg.pos === "bc" || logoCfg.pos === "bl" || logoCfg.pos === "br" ? 12 : "auto",
      left: logoCfg.pos === "bl" ? 12 : logoCfg.pos === "bc" ? "50%" : "auto",
      right: logoCfg.pos === "br" ? 12 : "auto",
      transform: logoCfg.pos === "bc" ? "translateX(-50%)" : "none",
      width: logoCfg.width, opacity: logoCfg.opacity, zIndex: 0, pointerEvents: "none", userSelect: "none", filter: "drop-shadow(0 0 1px rgba(0,0,0,.25))",
    }} />
  )

  const rootRef = useRef()

  return (
    <ErrorBoundary>
      <div className="stage" style={{ position: "relative", width: "100vw", height: "100vh", background: "black" }}>
        <PreloadIcons />
        {logoEl}

        {/* --------- panel (beze změn) ---------- */}
        {/* …(ponechán tvůj UI kód – sliders, eye, lights, env select)… */}

        {/* CANVAS */}
        <Canvas
          orthographic
          camera={{ position: [0, 0, 100], near: 0.01, far: 100000 }}
          gl={{ alpha: true }}
          onCreated={({ gl }) => {
            try {
              gl.setClearAlpha?.(0)
              if ("outputColorSpace" in gl && THREE?.SRGBColorSpace) gl.outputColorSpace = THREE.SRGBColorSpace
              else if ("outputEncoding" in gl && THREE?.sRGBEncoding !== undefined) gl.outputEncoding = THREE.sRGBEncoding
              if (THREE?.ACESFilmicToneMapping !== undefined) gl.toneMapping = THREE.ACESFilmicToneMapping
              if ("toneMappingExposure" in gl) gl.toneMappingExposure = 1.0
            } catch (e) { console.warn("GL setup warning:", e) }
          }}
          style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent" }}
        >
          <EnvLoader
            hdriUrl={HDRI_PRESETS[hdriKey]}
            envTexRef={envTexRef}
            onError={(msg) => setFatal((p) => p ?? msg)}
          />

          {!fatal && (
            <>
              <ambientLight intensity={lightIntensity * 0.3} />
              <directionalLight position={[lightPos1.x, lightPos1.y, lightPos1.z]} intensity={lightIntensity * 1.2} />
              <directionalLight position={[lightPos2.x, lightPos2.y, lightPos2.z]} intensity={lightIntensity * 0.9} />
              <directionalLight position={[lightPos3.x, lightPos3.y, lightPos3.z]} intensity={lightIntensity * 1.0} />
              <directionalLight position={[lightPos4.x, lightPos4.y, lightPos4.z]} intensity={lightIntensity * 0.7} />

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
                      onLoaded={() => setLoadedCount((n) => n + 1)}
                      autoSmooth={autoSmooth}
                      smoothAngle={smoothAngle}
                      roughness={roughnesses[i] ?? (typeof f.r === "number" ? f.r : 0.5)}
                      metalness={metalnesses[i] ?? (typeof f.m === "number" ? f.m : 0.5)}
                      useVertexColors={!!f.vc}
                      keepMaterials={!!f.km}
                    />
                  ))}
                </Suspense>
              </group>

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

        {/* styly – beze změn */}
      </div>
    </ErrorBoundary>
  )
}

/* ---------- ColorSwatch (beze změn) ---------- */
function ColorSwatch({ color, onChange, ariaLabel }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  useEffect(() => {
    const onDocClick = (e) => { if (open && containerRef.current && !containerRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [open])
  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
      <button aria-label={ariaLabel || "color picker"} onClick={() => setOpen((v) => !v)}
        style={{ width: 36, height: 22, borderRadius: 4, border: "1px solid #fff", background: color, cursor: "pointer", boxShadow: "0 0 0 1px rgba(0,0,0,.25) inset" }} />
      {open && (
        <div style={{ position: "absolute", zIndex: 20, top: 28, left: 0, background: "rgba(0,0,0,.92)", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", backdropFilter: "blur(4px)", boxShadow: "0 6px 24px rgba(0,0,0,.35)" }}>
          <HexColorPicker color={color} onChange={onChange} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ color: "#fff", fontSize: 12 }}>#</span>
            <HexColorInput color={color} onChange={onChange} prefixed={false}
              style={{ width: 90, padding: "4px 6px", borderRadius: 6, border: "1px solid #444", background: "#111", color: "#fff", fontFamily: "monospace", fontSize: 12 }} />
          </div>
        </div>
      )}
    </div>
  )
}
