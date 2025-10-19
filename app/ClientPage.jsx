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

/* ---------- Konst/Helpery ---------- */
const DEFAULT_LOGO = "/Arthetic_logo.png"
const LIVE_MSG_TYPE = "SHADE3D_LIVE"

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
  const s = String(nameOrUrl).split("?")[0]
  const m = s.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ""
}

/* ---------- Auto Smooth ---------- */
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

/* ---------- Inline loader ---------- */
function InlineLoader({ text }) {
  return (
    <Html center>
      <div style={{ background: "rgba(0,0,0,0.7)", padding: "16px 28px", borderRadius: 10, color: "white", fontFamily: "sans-serif", fontSize: 16 }}>
        ⏳ {text || "Načítám…"}
      </div>
    </Html>
  )
}

/* ---------- Headlight (kopíruje kameru) ---------- */
function Headlight({ enabled = true, intensity = 2, color = "#ffffff" }) {
  const { camera } = useThree()
  const ref = useRef(null)
  useFrame(() => { if (ref.current) ref.current.position.copy(camera.position) })
  return <pointLight ref={ref} color={color} intensity={enabled ? intensity : 0} distance={0} decay={0} />
}

/* ---------- Trackball ovládání ---------- */
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
    if (!controlsRef.current) return
    if (camera.isOrthographicCamera) controlsRef.current.panSpeed = camera.zoom * 0.4
    controlsRef.current.update()
  })

  return null
}

/* ---------- Smart AutoCenter & AutoFrame ---------- */
function AutoCenterAndFrame({ rootRef, depsKey, setTarget, margin = 1.2, isMobile = false, desktopScale = 0.4, mobileScale = 1.0, centerOnMount = false }) {
  const { camera, size } = useThree()
  const didCenterRef = useRef(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    // centerujeme pouze při mountu nebo když je o to výslovně požádáno změnou depsKey
    if (!centerOnMount && didCenterRef.current && !String(depsKey).startsWith("recenter-")) return

    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    if (box.isEmpty()) return

    const dims = new THREE.Vector3()
    const ctr = new THREE.Vector3()
    box.getSize(dims)
    box.getCenter(ctr)

    // posun rootu tak, aby byl kolem (0,0,0)
    root.position.sub(ctr)
    root.updateMatrixWorld(true)
    setTarget([0, 0, 0])

    // zoom pro ortho kameru
    const objW = Math.max(dims.x, 1e-6)
    const objH = Math.max(dims.y, 1e-6)
    const zoomX = size.width / (objW * margin)
    const zoomY = size.height / (objH * margin)
    let newZoom = Math.min(zoomX, zoomY)
    newZoom *= isMobile ? mobileScale : desktopScale

    camera.near = -100000 // velký rozsah, aby nic „neklipovalo“
    camera.far = 100000
    camera.zoom = Math.max(newZoom, 0.01)
    camera.position.set(0, 0, Math.abs(camera.position.z))
    camera.updateProjectionMatrix()

    didCenterRef.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depsKey, size.width, size.height, isMobile, desktopScale, mobileScale, margin, centerOnMount])

  return null
}

/* ---------- UI: Color swatch ---------- */
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
      <button aria-label={ariaLabel || "color picker"} onClick={() => setOpen((v) => !v)} className="swatch-btn" style={{ width: 36, height: 22, borderRadius: 4, border: "1px solid #fff", background: color, cursor: "pointer", boxShadow: "0 0 0 1px rgba(0,0,0,.25) inset" }} />
      {open && (
        <div className="swatch-pop" style={{ position: "absolute", zIndex: 20, top: 28, left: 0, background: "rgba(0,0,0,.92)", padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,.18)", backdropFilter: "blur(4px)", boxShadow: "0 6px 24px rgba(0,0,0,.35)" }}>
          <HexColorPicker color={color} onChange={onChange} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{ color: "#fff", fontSize: 12 }}>#</span>
            <HexColorInput color={color} onChange={onChange} prefixed={false} style={{ width: 90, padding: "4px 6px", borderRadius: 6, border: "1px solid #444", background: "#111", color: "#fff", fontFamily: "monospace", fontSize: 12 }} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Helper: vytvoř objectURL z binárního dílu ---------- */
function makeObjectUrlFromPart(part) {
  // part = { data: ArrayBuffer, mime?: string, n?: string }
  try {
    if (!part || !part.data) return null
    const blob = new Blob([part.data], { type: part.mime || "application/octet-stream" })
    const url = URL.createObjectURL(blob)
    return { url, name: part.n || "Model" }
  } catch {
    return null
  }
}
/* ---------- AnyModel loader ---------- */
function AnyModel({ file, color = "#ccc", visible = true, opacity = 1, roughness = 0.5, metalness = 0.5, useVC = false, keepMat = false, onLoaded }) {
  const groupRef = useRef(null)
  const [mesh, setMesh] = useState(null)

  useEffect(() => {
    if (!file?.url) return
    const ext = inferExt(file.url)
    let loader
    if (ext === "obj") loader = new OBJLoader()
    else if (ext === "stl") loader = new STLLoader()
    else if (ext === "ply") loader = new PLYLoader()
    else return

    let cancelled = false
    loader.load(
      file.url,
      (obj) => {
        if (cancelled) return
        let geom

        // OBJ → může obsahovat groupy
        if (obj.isBufferGeometry || obj.isGeometry) geom = obj
        else if (obj.isObject3D) {
          let firstMesh = null
          obj.traverse((c) => {
            if (c.isMesh && !firstMesh) firstMesh = c
          })
          if (firstMesh) geom = firstMesh.geometry
        }
        if (!geom) return

        // smooth + material
        const smoothed = autoSmoothGeometry(geom, 30)
        const mat = new THREE.MeshStandardMaterial({
          color,
          transparent: opacity < 1,
          opacity,
          roughness,
          metalness,
          side: THREE.DoubleSide,
        })
        const m = new THREE.Mesh(smoothed, mat)
        m.visible = visible
        m.castShadow = false
        m.receiveShadow = false
        setMesh(m)
        if (onLoaded) onLoaded(m)
      },
      undefined,
      (err) => console.warn("Load error", err)
    )
    return () => {
      cancelled = true
      if (mesh) mesh.geometry?.dispose()
    }
  }, [file?.url])

  useEffect(() => {
    if (mesh && mesh.material) {
      mesh.visible = visible
      mesh.material.color = new THREE.Color(color)
      mesh.material.opacity = opacity
      mesh.material.transparent = opacity < 1
      mesh.material.roughness = roughness
      mesh.material.metalness = metalness
      mesh.material.needsUpdate = true
    }
  }, [color, visible, opacity, roughness, metalness])

  return mesh ? <primitive ref={groupRef} object={mesh} /> : null
}

/* ---------- ClientPage hlavní komponenta ---------- */
export default function ClientPage() {
  const [files, setFiles] = useState([])
  const [title, setTitle] = useState(null)
  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO, opacity: 0.9, width: 160, pos: "bc" })
  const [lightIntensity, setLightIntensity] = useState(1)
  const [headlightCfg, setHeadlightCfg] = useState({ enabled: true, intensity: 2 })
  const [loadedCount, setLoadedCount] = useState(0)
  const [colors, setColors] = useState([])
  const [opacities, setOpacities] = useState([])
  const [visibles, setVisibles] = useState([])
  const [roughnesses, setRoughnesses] = useState([])
  const [metalnesses, setMetalnesses] = useState([])
  const [target, setTarget] = useState([0, 0, 0])
  const [depsKey, setDepsKey] = useState("init")

  const rootRef = useRef()
  const urlPoolRef = useRef([])

  // Pomocné: revokuj všechny objectURL
  const revokeAllUrls = () => {
    urlPoolRef.current.forEach((u) => { try { URL.revokeObjectURL(u) } catch {} })
    urlPoolRef.current = []
  }

  /* ---------- Načtení dat z URL nebo manifestu ---------- */
  useEffect(() => {
    const manifestUrl = getParam("m")
    if (!manifestUrl) return

    async function loadManifest() {
      try {
        const json = await fetchJSON(
          `https://jqnkdjgmenerioodqcpa.supabase.co/storage/v1/object/public/shade3d-viewer2/manifests/${manifestUrl}.json`
        )
        if (json.files) {
          setFiles(json.files)
          setColors(json.files.map((f, i) => f.c || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]))
          setOpacities(json.files.map((f) => f.o ?? 1))
          setVisibles(json.files.map((f) => f.v ?? true))
          setRoughnesses(json.files.map((f) => f.r ?? 0.5))
          setMetalnesses(json.files.map((f) => f.m ?? 0.5))
        }
        if (json.title) setTitle(json.title)
        if (json.logo?.url) {
          setLogoCfg((old) => ({
            ...old,
            url: json.logo.url,
            opacity: json.logo.opacity ?? old.opacity,
            width: json.logo.width ?? old.width,
            pos: json.logo.pos ?? old.pos,
          }))
        }
        if (json.lights) {
          setLightIntensity(json.lights.intensity ?? 1)
          setHeadlightCfg({
            enabled: json.lights.headlight?.enabled ?? true,
            intensity: json.lights.headlight?.intensity ?? 2,
          })
        }
      } catch (err) {
        console.error("Chyba při načtení manifestu:", err)
      }
    }

    loadManifest()
  }, [])

  /* ---------- LIVE PREVIEW z uploaderu (postMessage) ---------- */
  useEffect(() => {
    function handleMsg(e) {
      const data = e.data?.type === LIVE_MSG_TYPE ? e.data.payload : e.data
      if (!data) return

      // zrušíme staré objectURL (pokud je nový payload)
      revokeAllUrls()

      // 1) soubory
      if (Array.isArray(data.files)) {
        const Fs = data.files.map((x, i) => {
          let url = x.u
          if (!url && x.data) {
            const blob = new Blob([x.data], { type: x.mime || "application/octet-stream" })
            url = URL.createObjectURL(blob)
            urlPoolRef.current.push(url)
          }
          return {
            url,
            name: stripExt(x.n || `Model ${i + 1}`),
            rawName: x.n || `Model${i + 1}`,
            c: x.c,
            o: typeof x.o === "number" ? clamp01(x.o) : 1,
            v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? clamp01(x.r) : 0.5,
            m: typeof x.m === "number" ? clamp01(x.m) : 0.5,
            vc: !!x.vc,
            km: !!x.km,
          }
        })
        if (Fs.length > 0) {
          setFiles(Fs)
          setColors(Fs.map((f, i) => f.c || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]))
          setOpacities(Fs.map((f) => f.o))
          setVisibles(Fs.map((f) => f.v))
          setRoughnesses(Fs.map((f) => f.r))
          setMetalnesses(Fs.map((f) => f.m))
          setDepsKey("recenter-" + Date.now())
        } else {
          setFiles([]); setColors([]); setOpacities([]); setVisibles([])
          setRoughnesses([]); setMetalnesses([])
        }
      }

      // 2) titulek
      if (typeof data.title === "string" || data.title === null) setTitle(data.title ?? null)

      // 3) logo
      if (data.logo) {
        if (data.logo.url === null) setLogoCfg((o) => ({ ...o, url: null }))
        else if (data.logo.data) {
          const blob = new Blob([data.logo.data], { type: data.logo.mime || "image/png" })
          const url = URL.createObjectURL(blob)
          urlPoolRef.current.push(url)
          setLogoCfg((o) => ({
            ...o,
            url,
            opacity: data.logo.opacity ?? o.opacity,
            width: data.logo.width ?? o.width,
            pos: data.logo.pos ?? o.pos,
          }))
        } else if (typeof data.logo.url === "string") {
          setLogoCfg((o) => ({
            ...o,
            url: data.logo.url,
            opacity: data.logo.opacity ?? o.opacity,
            width: data.logo.width ?? o.width,
            pos: data.logo.pos ?? o.pos,
          }))
        }
      }

      // 4) světla
      if (data.lights) {
        if (typeof data.lights.intensity === "number") setLightIntensity(data.lights.intensity)
        if (data.lights.headlight)
          setHeadlightCfg((o) => ({
            enabled: data.lights.headlight.enabled ?? o.enabled,
            intensity: data.lights.headlight.intensity ?? o.intensity,
          }))
      }
    }

    window.addEventListener("message", handleMsg)
    return () => window.removeEventListener("message", handleMsg)
  }, [])
  /* ---------- Canvas & UI render ---------- */
  // paleta pro default barvy (pokud ji už nemáš nahoře, nech ji tady)
  const DEFAULT_PALETTE = ["#f5f5dc", "#8e8e8e", "#ffffff", "#ffd7a8", "#c0c0c0", "#e6f0ff", "#ffeedd"]

  const fillDim = headlightCfg.enabled ? 0.5 : 1

  const titleEl = title ? (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 2,
        color: "white",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 13,
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,.18)",
        background: "rgba(0,0,0,.35)",
        maxWidth: "min(60vw, 520px)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      title={title}
    >
      {title}
    </div>
  ) : null

  const logoEl = logoCfg.url ? (
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
        zIndex: 0,              // 👈 logo POD modelem
        pointerEvents: "none",
        userSelect: "none",
        filter: "drop-shadow(0 0 1px rgba(0,0,0,.25))",
      }}
    />
  ) : null

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "black" }}>
      {titleEl}
      {logoEl}

      <Canvas
        orthographic
        camera={{ position: [0, 0, 100], near: -100000, far: 100000 }}
        gl={{ alpha: true }}
        onCreated={({ gl, camera }) => {
          gl.setClearAlpha(0)
          // jistota proti „klipování“
          camera.near = -100000
          camera.far = 100000
          camera.updateProjectionMatrix()
        }}
        style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent" }} // 👈 canvas NAD logem
      >
        <ambientLight intensity={lightIntensity * 0.4 * fillDim} />
        <directionalLight position={[0, 5, 5]} intensity={lightIntensity * 1.5 * fillDim} />
        <directionalLight position={[-10, 0, 0]} intensity={lightIntensity * 1.0 * fillDim} />
        <directionalLight position={[10, 0, 0]} intensity={lightIntensity * 1.2 * fillDim} />
        <directionalLight position={[0, -5, -5]} intensity={lightIntensity * 0.8 * fillDim} />

        <Headlight enabled={headlightCfg.enabled} intensity={headlightCfg.intensity} />

        <group ref={rootRef}>
          <Suspense fallback={<InlineLoader text="Načítám modely…" />}>
            {files.map((f, i) => (
              <AnyModel
                key={`${f.url || f.name || i}-${i}`}
                file={f}
                color={colors[i] ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}
                visible={visibles[i] ?? true}
                opacity={typeof opacities[i] === "number" ? clamp01(opacities[i]) : 1}
                roughness={typeof roughnesses[i] === "number" ? clamp01(roughnesses[i]) : 0.5}
                metalness={typeof metalnesses[i] === "number" ? clamp01(metalnesses[i]) : 0.5}
                onLoaded={() => setLoadedCount((n) => n + 1)}
              />
            ))}
          </Suspense>
        </group>

        {/* AutoCenter dělá center pouze při mountu a když mu předáme depsKey začínající "recenter-" */}
        <AutoCenterAndFrame
          rootRef={rootRef}
          depsKey={depsKey}
          setTarget={setTarget}
          margin={1.2}
          desktopScale={0.4}
          mobileScale={1.0}
          centerOnMount={true}
        />
        <TouchTrackballControls target={target} />
      </Canvas>

      {/* Minimální globální styly (slider vzhled apod. — případně můžeš vynechat) */}
      <style jsx global>{`
        .slider { appearance: none; height: 14px; background: transparent; margin: 5px 0; display: inline-block; }
        .slider::-webkit-slider-runnable-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; margin-top: -5px; }
        .slider::-moz-range-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; border: none; }
      `}</style>
    </div>
  )
}
