"use client"

import { Canvas, useThree, useFrame } from "@react-three/fiber"
import * as THREE from "three"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { HexColorPicker, HexColorInput } from "react-colorful"
import { Html } from "@react-three/drei"
import { TrackballControls, OBJLoader, STLLoader, PLYLoader, RGBELoader } from "three-stdlib"

/* -------------------------------- Icons preload -------------------------------- */
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

/* -------------------------------- Helpers -------------------------------- */
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

/* ----------------------------- Auto Smooth (viewer-side) ----------------------------- */
function autoSmoothGeometry(geometry, angleDeg = 30) {
  const angle = Math.max(0, Math.min(89.9, angleDeg))
  const angleRad = (angle * Math.PI) / 180

  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const pos = g.getAttribute("position")
  const vCount = pos.count
  const triCount = vCount / 3

  const faceNormals = new Array(triCount)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const cb = new THREE.Vector3(), ab = new THREE.Vector3()
  for (let f = 0; f < triCount; f++) {
    const i0 = f * 3, i1 = i0 + 1, i2 = i0 + 2
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1)
    c.fromBufferAttribute(pos, i2)
    cb.subVectors(c, b)
    ab.subVectors(a, b)
    cb.cross(ab).normalize()
    faceNormals[f] = cb.clone()
  }

  const groups = new Map()
  const keyOf = (ix) => `${pos.getX(ix).toFixed(5)},${pos.getY(ix).toFixed(5)},${pos.getZ(ix).toFixed(5)}`
  for (let i = 0; i < vCount; i++) {
    const k = keyOf(i)
    let arr = groups.get(k)
    if (!arr) { arr = []; groups.set(k, arr) }
    arr.push(i)
  }

  const normals = new Float32Array(vCount * 3)
  const tmp = new THREE.Vector3()
  const cosThresh = Math.cos(angleRad)

  groups.forEach((cornerIndices) => {
    const localFaceNs = cornerIndices.map((ci) => faceNormals[Math.floor(ci / 3)])
    for (let idx = 0; idx < cornerIndices.length; idx++) {
      const ci = cornerIndices[idx]
      const nRef = localFaceNs[idx]
      let nx = 0, ny = 0, nz = 0
      for (let j = 0; j < localFaceNs.length; j++) {
        const nj = localFaceNs[j]
        if (nRef.dot(nj) >= cosThresh) { nx += nj.x; ny += nj.y; nz += nj.z }
      }
      tmp.set(nx, ny, nz)
      if (tmp.lengthSq() === 0) tmp.copy(nRef)
      tmp.normalize()
      const w = ci * 3
      normals[w] = tmp.x; normals[w + 1] = tmp.y; normals[w + 2] = tmp.z
    }
  })

  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}

/* -------------------------------- Inline loader -------------------------------- */
function InlineLoader({ text }) {
  return (
    <Html center>
      <div style={{ background: "rgba(0,0,0,0.7)", padding: "16px 28px", borderRadius: 10, color: "white", fontFamily: "sans-serif", fontSize: 16 }}>
        ⏳ {text || "Načítám…"}
      </div>
    </Html>
  )
}

/* -------------------------------- Model loader -------------------------------- */
function AnyModel({
  name, url,
  color, opacity, visible,
  onLoaded, autoSmooth, smoothAngle,
  roughness = 0.5, metalness = 0.5,
  useVertexColors = false,
  keepMaterials = false,
}) {
  const [object3D, setObject3D] = useState(null)
  const [loading, setLoading] = useState(true)
  const ext = useMemo(() => inferExt(name || url), [name, url])

  const makeMat = (opts = {}) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color || "#ffffff"),
      roughness: typeof roughness === "number" ? roughness : 0.5,
      metalness: typeof metalness === "number" ? metalness : 0.5,
      transparent: opacity < 1,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: opacity === 1,
      ...opts,
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
          obj = new THREE.Mesh(base, makeMat())
          obj.userData._baseGeom = geom
          obj.userData._derivedGeom = base
        } else if (ext === "ply") {
          const geom = await new PLYLoader().loadAsync(url)
          const hasVC = !!geom.getAttribute("color")
          let base = geom
          if (autoSmooth) base = autoSmoothGeometry(geom, smoothAngle)
          else if (!geom.attributes.normal) geom.computeVertexNormals()
          const mat = hasVC && useVertexColors
            ? makeMat({ vertexColors: true, color: new THREE.Color("#ffffff") })
            : makeMat()
          obj = new THREE.Mesh(base, mat)
          obj.userData._baseGeom = geom
          obj.userData._derivedGeom = base
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

  // AutoSmooth toggle/update
  useEffect(() => {
    if (!object3D) return
    object3D.traverse((child) => {
      if (!child.isMesh) return
      if (!child.userData._baseGeom) child.userData._baseGeom = child.geometry
      const base = child.userData._baseGeom
      let newGeom = base
      if (autoSmooth) newGeom = autoSmoothGeometry(base, smoothAngle)
      else { newGeom = base.clone(); newGeom.computeVertexNormals() }
      if (child.userData._derivedGeom && child.userData._derivedGeom !== base) {
        child.userData._derivedGeom.dispose()
      }
      child.geometry = newGeom
      child.userData._derivedGeom = newGeom
    })
  }, [object3D, autoSmooth, smoothAngle])

  // Appearance
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
          if (useVertexColors && "vertexColors" in mat) {
            mat.vertexColors = true
            if ("color" in mat) mat.color = new THREE.Color("#ffffff")
          }
          mat.needsUpdate = true
        }
      } else {
        const hasVC = !!child.geometry.getAttribute?.("color")
        const mat = hasVC && useVertexColors
          ? makeMat({ vertexColors: true, color: new THREE.Color("#ffffff") })
          : makeMat()
        child.material = mat
      }
    })
  }, [object3D, color, opacity, roughness, metalness, useVertexColors, keepMaterials])

  if (!object3D) return loading ? <InlineLoader text={`Načítám ${name || url}`} /> : null
  return visible ? <primitive object={object3D} /> : null
}

/* ----------------------------- Trackball (with ortho zoom clamp) ----------------------------- */
function TouchTrackballControls({ target = [0, 0, 0] }) {
  const { camera, gl } = useThree()
  const controlsRef = useRef(null)

  useEffect(() => {
    const controls = new TrackballControls(camera, gl.domElement)
    controls.rotateSpeed = 5.0
    controls.zoomSpeed = 1.2
    controls.panSpeed = 1.0
    controls.staticMoving = true
    controls.noZoom = false
    controls.noPan = false
    controlsRef.current = controls

    const ts = (e) => { e.preventDefault(); controls.handleTouchStart(e) }
    const tm = (e) => { e.preventDefault(); controls.handleTouchMove(e) }
    gl.domElement.addEventListener("touchstart", ts, { passive: false })
    gl.domElement.addEventListener("touchmove", tm, { passive: false })

    return () => {
      gl.domElement.removeEventListener("touchstart", ts)
      gl.domElement.removeEventListener("touchmove", tm)
      controls.dispose()
    }
  }, [camera, gl])

  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.set(target[0], target[1], target[2])
    controlsRef.current.update()
  }, [target])

  useFrame(() => {
    const c = controlsRef.current
    if (!c) return
    if (camera.isOrthographicCamera) {
      // clamp zoom so we can ALWAYS zoom back out
      camera.zoom = Math.min(500, Math.max(0.02, camera.zoom))
      c.panSpeed = camera.zoom * 0.4
      camera.updateProjectionMatrix()
    }
    c.update()
  })

  return null
}

/* ----------------------------- AutoCenter & AutoFrame ----------------------------- */
function AutoCenterAndFrame({
  rootRef, depsKey, setTarget,
  margin = 1.2, isMobile = false, desktopScale = 0.4, mobileScale = 1.0,
  centerMode = "combined",
}) {
  const { camera, size } = useThree()
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    root.updateMatrixWorld(true)
    const boxAll = new THREE.Box3().setFromObject(root)
    if (boxAll.isEmpty()) return

    const centerAll = new THREE.Vector3()
    const dims = new THREE.Vector3()
    boxAll.getCenter(centerAll)
    boxAll.getSize(dims)

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
    const dims2 = new THREE.Vector3()
    const ctr = new THREE.Vector3()
    after.getSize(dims2)
    after.getCenter(ctr)

    const objW = Math.max(dims2.x, 1e-6)
    const objH = Math.max(dims2.y, 1e-6)
    const zoomX = size.width / (objW * margin)
    const zoomY = size.height / (objH * margin)
    let newZoom = Math.min(zoomX, zoomY)
    newZoom *= isMobile ? mobileScale : desktopScale

    camera.near = 0.01
    camera.far = 100000
    camera.zoom = Math.max(newZoom, 0.02)
    camera.position.set(ctr.x, ctr.y, ctr.z + Math.abs(camera.position.z))
    camera.updateProjectionMatrix()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, size.width, size.height, isMobile, desktopScale, mobileScale, margin, centerMode])

  return null
}

/* ----------------------------- Environment (HDRI) ----------------------------- */
function EnvLoader({ hdriUrl, onError }) {
  const { scene, gl } = useThree()
  useEffect(() => {
    let disposed = false
    let pmrem = null
    let rt = null

    async function loadEnv() {
      try {
        // clean previous
        if (scene.environment && scene.environment.dispose) {
          scene.environment.dispose()
        }
        scene.environment = null
        scene.background = null

        if (!hdriUrl) return

        const loader = new RGBELoader()
        const hdr = await loader.loadAsync(hdriUrl)
        // PMREM from equirect
        pmrem = new THREE.PMREMGenerator(gl)
        pmrem.compileEquirectangularShader()
        rt = pmrem.fromEquirectangular(hdr)
        const envTex = rt.texture
        hdr.dispose()
        if (disposed) {
          envTex.dispose?.()
          return
        }
        scene.environment = envTex
        scene.background = null // necháváme průhledné
      } catch (e) {
        console.error("Env load error:", e)
        onError?.(String(e?.message || e))
      } finally {
        // PMREM render target drží envTex, to necháme na scene.environment
        if (pmrem) pmrem.dispose()
        // rt NElze dispose teď, protože by zrušilo texture; necháme three uklidit s environmentem
      }
    }

    loadEnv()
    return () => { disposed = true }
  }, [hdriUrl, scene, gl, onError])

  return null
}

/* ----------------------------- HDRI presets ----------------------------- */
const HDRI_PRESETS = {
  none: null,
  studioSoft: "/hdr/studio_small_03_1k.hdr",
}

/* -------------------------------- ClientPage -------------------------------- */
export default function ClientPage() {
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
    const coarse = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches
    const narrow = typeof window !== "undefined" && window.innerWidth < 768
    setIsMobile(uaMobile || coarse || narrow)
  }, [])

  const [title, setTitle] = useState(null)

  // modely
  const [files, setFiles] = useState([])
  const [colors, setColors] = useState([])
  const [opacities, setOpacities] = useState([])
  const [visibles, setVisibles] = useState([])
  const [roughnesses, setRoughnesses] = useState([])
  const [metalnesses, setMetalnesses] = useState([])
  const [fatal, setFatal] = useState(null)

  // auto smooth
  const [autoSmooth, setAutoSmooth] = useState((getParam("smooth") ?? "1") !== "0")
  const [smoothAngle, setSmoothAngle] = useState(() => {
    const v = parseFloat(getParam("smoothAngle") ?? "30")
    return isFinite(v) ? Math.max(0, Math.min(80, v)) : 30
  })

  // HDRI
  const [hdriKey, setHdriKey] = useState(getParam("env") || "studioSoft")
  const [envError, setEnvError] = useState(null)

  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO, opacity: 0.9, width: 160, pos: "bc" })

  const [cameraTarget, setCameraTarget] = useState([0, 0, 0])
  const [loadedCount, setLoadedCount] = useState(0)
  const handleModelLoaded = () => setLoadedCount((n) => n + 1)

  const centerParam = (getParam("center") || "combined").toLowerCase()
  const centerMode = ["per", "combined", "none"].includes(centerParam) ? centerParam : "combined"

  // init – manifest / files
  useEffect(() => {
    ;(async () => {
      try {
        const manifestUrl = getParam("manifest")
        if (manifestUrl) {
          const m = await fetchJSON(manifestUrl)
          const Fs = (m?.files || []).map((x, i) => ({
            url: x.u, name: stripExt(x.n) || `Model ${i + 1}`, rawName: x.n,
            c: x.c, o: typeof x.o === "number" ? x.o : 1, v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? x.r : 0.5, m: typeof x.m === "number" ? x.m : 0.5,
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
          const manifestEnv = m?.env
          if (manifestEnv && HDRI_PRESETS[manifestEnv] !== undefined) setHdriKey(manifestEnv)

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
          let arr = null
          try { arr = JSON.parse(f) } catch {}
          if (!arr) { try { arr = JSON.parse(decodeURIComponent(f)) } catch {} }
          if (!Array.isArray(arr)) throw new Error("Neplatný formát parametru ?files=")
          const Fs = arr.filter((x) => x && x.u).map((x, i) => ({
            url: x.u, name: stripExt(x.n) || `Model ${i + 1}`, rawName: x.n,
            c: x.c, o: typeof x.o === "number" ? x.o : 1, v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? x.r : 0.5, m: typeof x.m === "number" ? x.m : 0.5,
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
          const envKey = getParam("env")
          if (envKey && HDRI_PRESETS[envKey] !== undefined) setHdriKey(envKey)

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
          { url: "/models/Upper.obj", name: "Upper", rawName: "Upper.obj", r: 0.5, m: 0.5, v: true, vc: false, km: false },
          { url: "/models/Lower.stl", name: "Lower", rawName: "Lower.stl", r: 0.5, m: 0.5, v: true, vc: false, km: false },
          { url: "/models/Crown21.ply", name: "Bridge", rawName: "Crown21.ply", r: 0.5, m: 0.5, v: true, vc: false, km: false },
        ]
        setFiles(Fs)
        const palette = ["#f5f5dc", "#8e8e8e", "#ffffff"]
        setColors(Fs.map((_, i) => palette[i % palette.length]))
        setOpacities(Fs.map(() => 1))
        setVisibles(Fs.map((f) => f.v))
        setRoughnesses(Fs.map((f) => f.r))
        setMetalnesses(Fs.map((f) => f.m))
      } catch (e) {
        console.error(e)
        setFatal("Tento náhled není dostupný (chyba při načtení dat).")
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // LOGO element (pod canvasem)
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
      {logoEl}

      {/* Error toast pro env */}
      {envError && (
        <div style={{
          position: "absolute", top: 8, left: 8, zIndex: 3,
          background: "rgba(64,16,16,.95)", border: "1px solid #6f2a2a",
          color: "#ffbcbc", padding: "8px 10px", borderRadius: 8, fontSize: 12,
        }}>
          Viewer error<br />{envError}
        </div>
      )}

      {/* Ovládací panel */}
      <div
        className="controls-panel"
        style={{
          position: "absolute",
          top: 10, left: 10, zIndex: 2,
          color: "white", fontFamily: "sans-serif", fontSize: "14px",
          opacity: uiReady ? 1 : 0, transition: "opacity .12s ease",
          backdropFilter: "blur(3px)", background: "rgba(0,0,0,.25)",
          border: "1px solid rgba(255,255,255,.15)", borderRadius: 8,
          padding: "8px 10px", width: "clamp(240px, 30vw, 420px)",
          maxWidth: "calc(100vw - 20px)", boxSizing: "border-box",
          pointerEvents: "auto",
        }}
      >
        {fatal ? (
          <div style={{ color: "#ff8b8b" }}>{fatal}</div>
        ) : (
          <>
            {files.map((f, i) => (
              <div key={i} className="control-row" style={{
                display: "grid", gridTemplateColumns: "36px 1fr 26px",
                alignItems: "center", columnGap: 6, rowGap: 6, margin: "6px 0",
              }}>
                {/* Label */}
                <div className="row-label" style={{ gridColumn: "1 / -1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.rawName || f.name}>
                  {stripExt(f.name)}:
                </div>

                {/* Swatch */}
                <div className="row-swatch">
                  <ColorSwatch
                    color={colors[i] ?? "#ffffff"}
                    onChange={(c) => setColors((prev) => prev.map((v, idx) => (idx === i ? c : v)))}
                    ariaLabel={`${f.name} color`}
                  />
                </div>

                {/* Opacity */}
                <div className="row-slider" style={{ minWidth: 0 }}>
                  <input
                    className="slider"
                    type="range"
                    min={0} max={1} step={0.01}
                    value={opacities[i] ?? 1}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value)
                      setOpacities((prev) => prev.map((x, idx) => (idx === i ? v : x)))
                    }}
                    style={{ width: "calc(100% - 18px)", minWidth: 140 }}
                    aria-label={`${f.name} opacity`}
                  />
                </div>

                {/* Eye */}
                <button
                  className={`toggle icon-btn ${visibles[i] ? "is-on" : "is-off"}`}
                  onClick={() => setVisibles((prev) => prev.map((v, idx) => (idx === i ? !v : v)))}
                  aria-label={visibles[i] ? `Hide ${f.name}` : `Show ${f.name}`}
                  style={{
                    position: "relative", width: 26, height: 22, padding: 0,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    overflow: "hidden", background: "transparent",
                    border: "1px solid white", borderRadius: 6, color: "white", cursor: "pointer",
                  }}
                >
                  <img src={ICONS.eye} alt="" width="18" height="18" style={{ position: "absolute", inset: 0, width: 18, height: 18, margin: "auto", opacity: visibles[i] ? 1 : 0, transition: "opacity .06s linear" }}/>
                  <img src={ICONS.eyeOff} alt="" width="18" height="18" style={{ position: "absolute", inset: 0, width: 18, height: 18, margin: "auto", opacity: visibles[i] ? 0 : 1, transition: "opacity .06s linear" }}/>
                </button>

                {/* Druhý řádek: Roughness + Metalness */}
                <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", columnGap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>R:</span>
                  <input
                    className="slider"
                    type="range"
                    min={0} max={1} step={0.01}
                    value={roughnesses[i] ?? (typeof f.r === "number" ? f.r : 0.5)}
                    onChange={(e) => {
                      const v = clamp01(parseFloat(e.target.value))
                      setRoughnesses((prev) => prev.map((x, idx) => (idx === i ? v : (typeof x === "number" ? x : (idx === i ? v : 0.5)))))
                    }}
                    style={{ width: "100%", minWidth: 120 }}
                    aria-label={`${f.name} roughness`}
                  />
                  <span style={{ fontSize: 12, opacity: 0.85 }}>M:</span>
                  <input
                    className="slider"
                    type="range"
                    min={0} max={1} step={0.01}
                    value={metalnesses[i] ?? (typeof f.m === "number" ? f.m : 0.5)}
                    onChange={(e) => {
                      const v = clamp01(parseFloat(e.target.value))
                      setMetalnesses((prev) => prev.map((x, idx) => (idx === i ? v : (typeof x === "number" ? x : (idx === i ? v : 0.5)))))
                    }}
                    style={{ width: "100%", minWidth: 120 }}
                    aria-label={`${f.name} metalness`}
                  />
                </div>
              </div>
            ))}

            {/* Světla + Titulek + AutoSmooth + HDRI preset */}
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", alignItems: "center", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  className={`toggle arrow-toggle ${showLights ? "is-open" : "is-closed"}`}
                  onClick={() => setShowLights(!showLights)}
                  aria-label="Toggle lights panel"
                  style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", border: "1px solid white", borderRadius: 6, background: "transparent", color: "white", cursor: "pointer" }}
                >
                  <span className="arrow-stack" aria-hidden style={{ position: "relative", width: 16, height: 16, display: "inline-block" }}>
                    <img src={ICONS.arrowClosed} width="16" height="16" style={{ position: "absolute", left: 0, top: 0, opacity: showLights ? 0 : 1 }} alt="" />
                    <img src={ICONS.arrowOpen} width="16" height="16" style={{ position: "absolute", left: 0, top: 0, opacity: showLights ? 1 : 0 }} alt="" />
                  </span>
                  <span className="arrow-label">Světla</span>
                </button>

                {title && (
                  <div title={title} style={{ maxWidth: 220, padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.08)", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {title}
                  </div>
                )}

                {/* HDRI preset select */}
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ opacity: .9 }}>Prostředí:</span>
                  <select
                    value={hdriKey}
                    onChange={(e) => { setEnvError(null); setHdriKey(e.target.value) }}
                    style={{ background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.2)", borderRadius: 6, padding: "4px 8px" }}
                  >
                    <option value="none">Žádné</option>
                    <option value="studioSoft">Studio – soft</option>
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={autoSmooth} onChange={(e) => setAutoSmooth(e.target.checked)} />
                  <span>Auto smooth</span>
                </label>
                <span style={{ opacity: 0.8, fontSize: 12 }}>Úhel: {Math.round(smoothAngle)}°</span>
                <input className="slider" type="range" min={0} max={80} step={1} value={smoothAngle} onChange={(e) => setSmoothAngle(parseFloat(e.target.value))} style={{ width: 120 }} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* CANVAS */}
      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], near: 0.01, far: 100000 }}
        gl={{ alpha: true }}
        onCreated={({ gl }) => {
          gl.setClearAlpha(0)
          if ("outputColorSpace" in gl) {
            gl.outputColorSpace = THREE.SRGBColorSpace
          } else if ("outputEncoding" in gl) {
            gl.outputEncoding = THREE.sRGBEncoding
          }
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.0
        }}
        style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent" }}
      >
        {/* HDRI prostředí */}
        <EnvLoader hdriUrl={HDRI_PRESETS[hdriKey]} onError={setEnvError} />

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
                    onLoaded={handleModelLoaded}
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

      {/* Globální styly */}
      <style jsx global>{`
        .slider { appearance: none; height: 14px; background: transparent; margin: 5px 0; display: inline-block; }
        .slider::-webkit-slider-runnable-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; margin-top: -5px; }
        .slider::-moz-range-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; border: none; }

        @media (max-width: 720px) {
          .controls-panel {
            left: 8px !important;
            right: 8px;
            width: auto !important;
            max-width: calc(100vw - 16px) !important;
          }
        }
      `}</style>
    </div>
  )
}

/* ----------------------------- ColorSwatch ----------------------------- */
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
