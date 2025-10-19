"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { OrbitControls, Html } from "@react-three/drei"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader"

/* ---------- Live zprávy ---------- */
const LIVE_TYPES = ["SHADE3D_LIVE", "SHADE3D_LIVE_V6", "SHADE3D_LIVE_V5"]

/* ---------- Util ---------- */
const DEFAULT_LOGO = "/Arthetic_logo.png"
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const stripExt = (s) => (s || "").replace(/\.[^.]+$/, "")
const inferExt = (nameOrUrl) => {
  if (!nameOrUrl) return ""
  const s = nameOrUrl.split("?")[0]
  const m = s.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ""
}
const getParam = (name) => {
  if (typeof window === "undefined") return null
  return new URL(window.location.href).searchParams.get(name)
}
async function fetchJSON(url) {
  const r = await fetch(url, { cache: "no-store" })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/* ---------- AutoSmooth ---------- */
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
  const keyOf = (ix) =>
    `${pos.getX(ix).toFixed(5)},${pos.getY(ix).toFixed(5)},${pos.getZ(ix).toFixed(5)}`
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

/* ---------- UI ---------- */
function InlineLoader({ text }) {
  return (
    <Html center>
      <div style={{
        background: "rgba(0,0,0,0.7)",
        padding: "14px 22px",
        borderRadius: 10,
        color: "white",
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 14
      }}>
        ⏳ {text || "Načítám…"}
      </div>
    </Html>
  )
}

/* ---------- AnyModel ---------- */
function AnyModel({
  name, url,
  color, opacity, visible,
  onLoaded,
  autoSmoothOn, smoothAngle,
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
          const base = autoSmoothOn ? autoSmoothGeometry(geom, smoothAngle) : (geom.computeVertexNormals(), geom)
          const mat = makeMat()
          obj = new THREE.Mesh(base, mat)
        } else if (ext === "ply") {
          const geom = await new PLYLoader().loadAsync(url)
          const hasVC = !!geom.getAttribute("color")
          let base = geom
          if (autoSmoothOn) base = autoSmoothGeometry(geom, smoothAngle)
          else if (!geom.attributes.normal) geom.computeVertexNormals()
          const mat = hasVC && useVertexColors
            ? makeMat({ vertexColors: true, color: new THREE.Color("#ffffff") })
            : makeMat()
          obj = new THREE.Mesh(base, mat)
        } else {
          const loaded = await new OBJLoader().loadAsync(url)
          if (keepMaterials) {
            loaded.traverse((child) => {
              if (child.isMesh) {
                const mat = child.material
                if (mat) {
                  mat.transparent = opacity < 1
                  mat.opacity = opacity
                  if ("roughness" in mat) mat.roughness = roughness
                  if ("metalness" in mat) mat.metalness = metalness
                  if (!useVertexColors && color) mat.color = new THREE.Color(color)
                  if (useVertexColors) mat.vertexColors = true
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
  }, [url, ext])

  if (!object3D) return loading ? <InlineLoader text={`Načítám ${name || url}`} /> : null
  return visible ? <primitive object={object3D} /> : null
}

/* ---------- Headlight ---------- */
function Headlight({ enabled = true, intensity = 2, color = "#ffffff" }) {
  const { camera } = useThree()
  const ref = useRef(null)
  useFrame(() => { if (ref.current) ref.current.position.copy(camera.position) })
  return <pointLight ref={ref} color={color} intensity={enabled ? intensity : 0} distance={0} decay={0} />
}

/* ---------- AutoCenter ---------- */
function AutoCenterAndFrameOnce({ rootRef, triggerKey, margin = 1.2 }) {
  const { camera, size } = useThree()
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return
    const dims = new THREE.Vector3()
    const ctr = new THREE.Vector3()
    box.getSize(dims)
    box.getCenter(ctr)
    const objW = Math.max(dims.x, 1e-6)
    const objH = Math.max(dims.y, 1e-6)
    const zoomX = size.width / (objW * margin)
    const zoomY = size.height / (objH * margin)
    const newZoom = Math.max(0.01, Math.min(zoomX, zoomY))
    const diag = Math.sqrt(dims.x * dims.x + dims.y * dims.y + dims.z * dims.z)
    const safeDist = Math.max(diag * 2.5, 1000)
    camera.near = 0.1
    camera.far = Math.max(safeDist * 10, 1e6)
    camera.zoom = newZoom
    camera.position.set(ctr.x, ctr.y, ctr.z + safeDist)
    camera.updateProjectionMatrix()
  }, [triggerKey, camera, size.width, size.height, margin])
  return null
}

/* ---------- VIEWER ---------- */
export default function ClientPage() {
  const [lightIntensity, setLightIntensity] = useState(1)
  const [headlightCfg, setHeadlightCfg] = useState({ enabled: true, intensity: 2 })
  const [title, setTitle] = useState(null)
  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO, opacity: 0.9, width: 160, pos: "bc" })
  const [files, setFiles] = useState([])
  const [colors, setColors] = useState([])
  const [opacities, setOpacities] = useState([])
  const [visibles, setVisibles] = useState([])
  const [roughnesses, setRoughnesses] = useState([])
  const [metalnesses, setMetalnesses] = useState([])
  const [fatal, setFatal] = useState(null)
  const [autoSmooth] = useState(true)
  const [smoothAngle] = useState(30)
  const [loadedCount, setLoadedCount] = useState(0)
  const rootRef = useRef(null)
  const [frameTick, setFrameTick] = useState(0)
  const handleModelLoaded = () => setLoadedCount((n) => n + 1)

  /* ---- LIVE listener + HANDSHAKE ---- */
  const applyLivePayload = (p) => {
    if (!p) return
    if (Array.isArray(p.files)) {
      const newFiles = p.files.map((x, i) => ({
        url: x.u, name: stripExt(x.n || `Model ${i + 1}`), c: x.c, o: clamp01(x.o || 1),
        v: x.v !== false, r: clamp01(x.r || 0.5), m: clamp01(x.m || 0.5),
        vc: !!x.vc, km: !!x.km,
      }))
      setFiles(newFiles)
      const palette = ["#f5f5dc","#8e8e8e","#ffffff","#ffd7a8","#c0c0c0","#e6f0ff","#ffeedd"]
      setColors(newFiles.map((f, i) => f.c || palette[i % palette.length]))
      setOpacities(newFiles.map((f) => f.o))
      setVisibles(newFiles.map((f) => f.v))
      setRoughnesses(newFiles.map((f) => f.r))
      setMetalnesses(newFiles.map((f) => f.m))
      setLoadedCount(0)
    }
    if (typeof p.title === "string" || p.title === null) setTitle(p.title ?? null)
    if (p.logo) {
      setLogoCfg((old) => ({
        url: p.logo.url ?? old.url,
        opacity: typeof p.logo.opacity === "number" ? clamp01(p.logo.opacity) : old.opacity,
        width: typeof p.logo.width === "number" ? p.logo.width : old.width,
        pos: p.logo.pos || old.pos,
      }))
    }
    if (p.lights) {
      if (typeof p.lights.intensity === "number") setLightIntensity(p.lights.intensity)
      if (p.lights.headlight) {
        setHeadlightCfg({
          enabled: typeof p.lights.headlight.enabled === "boolean" ? p.lights.headlight.enabled : true,
          intensity: typeof p.lights.headlight.intensity === "number" ? p.lights.headlight.intensity : 2,
        })
      }
    }
  }

  useEffect(() => {
    const onMsg = (e) => {
      const data = e.data
      if (!data) return
      const t = data.type
      const p = data.payload
      if (LIVE_TYPES.includes(t) && p) applyLivePayload(p)
    }
    window.addEventListener("message", onMsg)
    try { window.parent?.postMessage({ type: "SHADE3D_LIVE_READY" }, "*") } catch {}
    return () => window.removeEventListener("message", onMsg)
  }, [])

  useEffect(() => {
    if (files.length > 0 && loadedCount === files.length) setFrameTick((t) => t + 1)
  }, [files.length, loadedCount])

  const logoEl = logoCfg.url && (
    <img
      src={logoCfg.url}
      alt=""
      style={{
        position: "absolute",
        bottom: 12,
        left: logoCfg.pos === "bl" ? 12 : logoCfg.pos === "bc" ? "50%" : "auto",
        right: logoCfg.pos === "br" ? 12 : "auto",
        transform: logoCfg.pos === "bc" ? "translateX(-50%)" : "none",
        width: logoCfg.width,
        opacity: logoCfg.opacity,
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  )

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "black" }}>
      {logoEl}
      {title && (
        <div style={{
          position: "absolute", top: 10, left: 10, zIndex: 2,
          padding: "6px 10px", borderRadius: 8,
          border: "1px solid rgba(255,255,255,.18)", background: "rgba(255,255,255,.08)",
          fontSize: 13, fontWeight: 600, color: "#fff"
        }}>
          {title}
        </div>
      )}
      <Canvas orthographic camera={{ position: [0, 0, 1000], near: 0.1, far: 1e7 }} gl={{ alpha: true }}>
        {!fatal && (
          <>
            <ambientLight intensity={lightIntensity * 0.4} />
            <directionalLight position={[0, 5, 5]} intensity={lightIntensity * 1.5} />
            <directionalLight position={[-10, 0, 0]} intensity={lightIntensity * 1.0} />
            <Headlight enabled={headlightCfg.enabled} intensity={headlightCfg.intensity} />
            <group ref={rootRef}>
              <Suspense fallback={null}>
                {files.map((f, i) => (
                  <AnyModel key={f.url + i} name={f.name} url={f.url}
                    color={colors[i]} opacity={opacities[i]} visible={visibles[i]}
                    onLoaded={handleModelLoaded} autoSmoothOn={autoSmooth} smoothAngle={smoothAngle}
                    roughness={roughnesses[i]} metalness={metalnesses[i]}
                    useVertexColors={f.vc} keepMaterials={f.km} />
                ))}
              </Suspense>
            </group>
            <AutoCenterAndFrameOnce rootRef={rootRef} triggerKey={`frame-${files.length}-${frameTick}`} margin={1.2} />
            <OrbitControls enableDamping dampingFactor={0.12} />
          </>
        )}
        {fatal && <InlineLoader text={fatal} />}
      </Canvas>
    </div>
  )
}
