"use client"

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { OrbitControls, Html } from "@react-three/drei"
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader"
import { STLLoader } from "three/examples/jsm/loaders/STLLoader"
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader"

/* ---------- Live zprávy ---------- */
const LIVE_TYPES = ["SHADE3D_LIVE", "SHADE3D_LIVE_V6", "SHADE3D_LIVE_V5"] as const

/* ---------- Util ---------- */
const DEFAULT_LOGO = "/Arthetic_logo.png"
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const stripExt = (s?: string) => (s || "").replace(/\.[^.]+$/, "")
const inferExt = (nameOrUrl?: string) => {
  if (!nameOrUrl) return ""
  const s = nameOrUrl.split("?")[0]
  const m = s.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : ""
}
const getParam = (name: string) => {
  if (typeof window === "undefined") return null
  return new URL(window.location.href).searchParams.get(name)
}
async function fetchJSON(url: string) {
  const r = await fetch(url, { cache: "no-store" })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/* ---------- AutoSmooth ---------- */
function autoSmoothGeometry(geometry: THREE.BufferGeometry, angleDeg = 30) {
  const angle = Math.max(0, Math.min(89.9, angleDeg))
  const angleRad = (angle * Math.PI) / 180

  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const pos = g.getAttribute("position") as THREE.BufferAttribute
  const vCount = pos.count
  const triCount = vCount / 3

  const faceNormals: THREE.Vector3[] = new Array(triCount)
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

  const groups = new Map<string, number[]>()
  const keyOf = (ix: number) =>
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
function InlineLoader({ text }: { text?: string }) {
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
}: {
  name?: string
  url: string
  color?: string
  opacity: number
  visible: boolean
  onLoaded?: (o: THREE.Object3D) => void
  autoSmoothOn: boolean
  smoothAngle: number
  roughness?: number
  metalness?: number
  useVertexColors?: boolean
  keepMaterials?: boolean
}) {
  const [object3D, setObject3D] = useState<THREE.Object3D | null>(null)
  const [loading, setLoading] = useState(true)
  const ext = useMemo(() => inferExt(name || url), [name, url])

  const makeMat = (opts: THREE.MeshStandardMaterialParameters = {}) =>
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
        let obj: THREE.Object3D
        if (ext === "stl") {
          const geom = await new STLLoader().loadAsync(url)
          if (!geom.attributes.normal) geom.computeVertexNormals()
          const base = autoSmoothOn ? autoSmoothGeometry(geom, smoothAngle) : (geom.computeVertexNormals(), geom)
          const mat = makeMat()
          const mesh = new THREE.Mesh(base, mat)
          mesh.userData._baseGeom = geom
          mesh.userData._derivedGeom = base
          obj = mesh
        } else if (ext === "ply") {
          const geom = await new PLYLoader().loadAsync(url)
          const hasVC = !!geom.getAttribute("color")
          let base = geom
          if (autoSmoothOn) base = autoSmoothGeometry(geom, smoothAngle)
          else if (!geom.attributes.normal) geom.computeVertexNormals()

          const mat = hasVC && useVertexColors
            ? makeMat({ vertexColors: true, color: new THREE.Color("#ffffff") })
            : makeMat()
          const mesh = new THREE.Mesh(base, mat)
          mesh.userData._baseGeom = geom
          mesh.userData._derivedGeom = base
          obj = mesh
        } else {
          // OBJ
          const loaded = await new OBJLoader().loadAsync(url)
          if (keepMaterials) {
            loaded.traverse((child: any) => {
              if (child.isMesh) {
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
                }
              }
            })
            obj = loaded
          } else {
            const mat = makeMat()
            loaded.traverse((child: any) => { if (child.isMesh) child.material = mat })
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

  // Re-apply material parameters on prop change (for keepMaterials & VC)
  useEffect(() => {
    if (!object3D) return
    object3D.traverse((child: any) => {
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
        const hasVC = !!child.geometry?.getAttribute?.("color")
        const mat = hasVC && useVertexColors
          ? makeMat({ vertexColors: true, color: new THREE.Color("#ffffff") })
          : makeMat()
        child.material = mat
      }
    })
  }, [object3D, color, opacity, roughness, metalness, useVertexColors, keepMaterials])

  // Rebuild normals / smooth on toggle
  useEffect(() => {
    if (!object3D) return
    object3D.traverse((child: any) => {
      if (!child.isMesh) return
      if (!child.userData._baseGeom) child.userData._baseGeom = child.geometry
      const base: THREE.BufferGeometry = child.userData._baseGeom
      let newGeom = base
      if (autoSmoothOn) newGeom = autoSmoothGeometry(base, smoothAngle)
      else {
        newGeom = base.clone()
        newGeom.computeVertexNormals()
      }
      if (child.userData._derivedGeom && child.userData._derivedGeom !== base) {
        child.userData._derivedGeom.dispose()
      }
      child.geometry = newGeom
      child.userData._derivedGeom = newGeom
    })
  }, [object3D, autoSmoothOn, smoothAngle])

  if (!object3D) return loading ? <InlineLoader text={`Načítám ${name || url}`} /> : null
  return visible ? <primitive object={object3D} /> : null
}

/* ---------- Headlight (u kamery) ---------- */
function Headlight({ enabled = true, intensity = 2, color = "#ffffff" }: {enabled?: boolean, intensity?: number, color?: string}) {
  const { camera } = useThree()
  const ref = useRef<THREE.PointLight>(null)
  useFrame(() => { if (ref.current) ref.current.position.copy(camera.position) })
  return <pointLight ref={ref} color={color} intensity={enabled ? intensity : 0} distance={0} decay={0} />
}

/* ---------- AutoCenter po načtení VŠECH modelů ---------- */
function AutoCenterAndFrameOnce({
  rootRef,
  triggerKey,
  margin = 1.2,
}: {
  rootRef: React.MutableRefObject<THREE.Group | null>
  triggerKey: string
  margin?: number
}) {
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

    // ortho fit přes zoom
    const objW = Math.max(dims.x, 1e-6)
    const objH = Math.max(dims.y, 1e-6)
    const zoomX = size.width / (objW * margin)
    const zoomY = size.height / (objH * margin)
    const newZoom = Math.max(0.01, Math.min(zoomX, zoomY))

    const diag = Math.sqrt(dims.x * dims.x + dims.y * dims.y + dims.z * dims.z)
    const safeDist = Math.max(diag * 2.5, 1000)

    camera.near = 0.1
    camera.far = Math.max(safeDist * 10, 1e6)
    ;(camera as THREE.OrthographicCamera).zoom = newZoom
    camera.position.set(ctr.x, ctr.y, ctr.z + safeDist)
    camera.updateProjectionMatrix()
  }, [triggerKey, camera, size.width, size.height, margin])
  return null
}

/* ---------- VIEWER ---------- */
export default function ClientPage() {
  // světla (ovládaná přes manifest/URL/live)
  const [lightIntensity, setLightIntensity] = useState(1)
  const [headlightCfg, setHeadlightCfg] = useState({ enabled: true, intensity: 2.0 })

  const [title, setTitle] = useState<string | null>(null)
  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO as string | null, opacity: 0.9, width: 160, pos: "bc" as "bl" | "bc" | "br" })

  // modely + jejich vizuál
  const [files, setFiles] = useState<any[]>([]) // {url,name,rawName,c,o,v,r,m,vc,km}
  const [colors, setColors] = useState<string[]>([])
  const [opacities, setOpacities] = useState<number[]>([])
  const [visibles, setVisibles] = useState<boolean[]>([])
  const [roughnesses, setRoughnesses] = useState<number[]>([])
  const [metalnesses, setMetalnesses] = useState<number[]>([])
  const [fatal, setFatal] = useState<string | null>(null)

  // AutoSmooth (lze řídit parametrem, default ON)
  const [autoSmooth, setAutoSmooth] = useState((getParam("smooth") ?? "1") !== "0")
  const [smoothAngle] = useState(() => {
    const v = parseFloat(getParam("smoothAngle") ?? "30")
    return isFinite(v) ? Math.max(0, Math.min(80, v)) : 30
  })

  // načítání modelů + trigger pro frame (po načtení všech)
  const [loadedCount, setLoadedCount] = useState(0)
  const rootRef = useRef<THREE.Group>(null)
  const prevFileKeysRef = useRef<string[]>([])
  const [frameTick, setFrameTick] = useState(0) // mění se až po načtení všech

  const handleModelLoaded = () => setLoadedCount((n) => n + 1)
  const getFileKeys = (arr: any[]) => (arr || []).map((f) => `${f.url}::${f.rawName || f.name}`)

  /* ---- Inicializace z manifestu/URL (jen jednou) ---- */
  useEffect(() => {
    ;(async () => {
      try {
        const manifestUrl = getParam("manifest")
        if (manifestUrl) {
          const m = await fetchJSON(manifestUrl)
          const Fs = (m?.files || []).map((x: any, i: number) => ({
            url: x.u,
            name: stripExt(x.n) || `Model ${i + 1}`,
            rawName: x.n,
            c: x.c, o: typeof x.o === "number" ? clamp01(x.o) : 1,
            v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? clamp01(x.r) : 0.5,
            m: typeof x.m === "number" ? clamp01(x.m) : 0.5,
            vc: !!x.vc, km: !!x.km,
          }))
          if (!Fs.length) throw new Error("Manifest je prázdný.")
          setFiles(Fs)
          const palette = ["#f5f5dc","#8e8e8e","#ffffff","#ffd7a8","#c0c0c0","#e6f0ff","#ffeedd"]
          setColors(Fs.map((f: any, i: number) => f.c || palette[i % palette.length]))
          setOpacities(Fs.map((f: any) => f.o))
          setVisibles(Fs.map((f: any) => f.v))
          setRoughnesses(Fs.map((f: any) => f.r))
          setMetalnesses(Fs.map((f: any) => f.m))
          setTitle(typeof m?.title === "string" ? m.title : (getParam("title") ?? null))

          const logoUrl = m?.logo?.url || DEFAULT_LOGO
          setLogoCfg({
            url: logoUrl || null,
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10),
            pos: (getParam("logoPos") as any) || "bc",
          })

          const hl = m?.lights?.headlight
          if (hl && typeof hl === "object") {
            setHeadlightCfg({
              enabled: typeof hl.enabled === "boolean" ? hl.enabled : true,
              intensity: typeof hl.intensity === "number" ? hl.intensity : 2.0,
            })
          } else {
            const qOn = getParam("headlight")
            const qI = parseFloat(getParam("headlightI") ?? "NaN")
            setHeadlightCfg({ enabled: qOn == null ? true : qOn !== "0", intensity: isFinite(qI) ? qI : 2.0 })
          }

          prevFileKeysRef.current = getFileKeys(Fs)
          setLoadedCount(0)
          return
        }

        const f = getParam("files")
        if (f) {
          let arr: any = null
          try { arr = JSON.parse(f) } catch {}
          if (!arr) { try { arr = JSON.parse(decodeURIComponent(f)) } catch {} }
          if (!Array.isArray(arr)) throw new Error("Neplatný formát parametru ?files=")
          const Fs = arr.filter((x) => x && x.u).map((x: any, i: number) => ({
            url: x.u,
            name: stripExt(x.n) || `Model ${i + 1}`,
            rawName: x.n,
            c: x.c, o: typeof x.o === "number" ? clamp01(x.o) : 1,
            v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? clamp01(x.r) : 0.5,
            m: typeof x.m === "number" ? clamp01(x.m) : 0.5,
            vc: !!x.vc, km: !!x.km,
          }))
          setFiles(Fs)
          const palette = ["#f5f5dc","#8e8e8e","#ffffff","#ffd7a8","#c0c0c0","#e6f0ff","#ffeedd"]
          setColors(Fs.map((f: any, i: number) => f.c || palette[i % palette.length]))
          setOpacities(Fs.map((f: any) => f.o))
          setVisibles(Fs.map((f: any) => f.v))
          setRoughnesses(Fs.map((f: any) => f.r))
          setMetalnesses(Fs.map((f: any) => f.m))
          setTitle(getParam("title") ?? null)
          setLogoCfg({
            url: getParam("logo") === "none" ? null : (getParam("logo") || DEFAULT_LOGO),
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10),
            pos: (getParam("logoPos") as any) || "bc",
          })
          const qOn = getParam("headlight")
          const qI = parseFloat(getParam("headlightI") ?? "NaN")
          setHeadlightCfg({ enabled: qOn == null ? true : qOn !== "0", intensity: isFinite(qI) ? qI : 2.0 })
          prevFileKeysRef.current = getFileKeys(Fs)
          setLoadedCount(0)
          return
        }

        // čisté plátno
        setFiles([]); setColors([]); setOpacities([]); setVisibles([]); setRoughnesses([]); setMetalnesses([])
      } catch (e) {
        console.error(e)
        setFatal("Tento náhled není dostupný (chyba při načtení dat).")
      }
    })()
  }, [])

  /* ---- LIVE listener + HANDSHAKE ---- */
  const applyLivePayload = (p: any) => {
    if (!p) return

    // files (volitelné)
    if (Array.isArray(p.files)) {
      const newFiles = p.files.map((x: any, i: number) => ({
        url: x.u,
        name: stripExt(x.n || `Model ${i + 1}`),
        rawName: x.n || `Model${i + 1}`,
        c: x.c,
        o: typeof x.o === "number" ? clamp01(x.o) : 1,
        v: typeof x.v === "boolean" ? x.v : true,
        r: typeof x.r === "number" ? clamp01(x.r) : 0.5,
        m: typeof x.m === "number" ? clamp01(x.m) : 0.5,
        vc: !!x.vc,
        km: !!x.km,
      }))

      const newKeys = newFiles.map(f => `${f.url}::${f.rawName || f.name}`)
      const prevKeys = prevFileKeysRef.current
      const changed =
        newKeys.length !== prevKeys.length ||
        newKeys.some((k, i) => k !== prevKeys[i])

      setFiles(newFiles)
      prevFileKeysRef.current = newKeys

      const palette = ["#f5f5dc","#8e8e8e","#ffffff","#ffd7a8","#c0c0c0","#e6f0ff","#ffeedd"]
      setColors(newFiles.map((f: any, i: number) => f.c || palette[i % palette.length]))
      setOpacities(newFiles.map((f: any) => f.o))
      setVisibles(newFiles.map((f: any) => f.v))
      setRoughnesses(newFiles.map((f: any) => f.r))
      setMetalnesses(newFiles.map((f: any) => f.m))

      if (changed) setLoadedCount(0) // znovu čekáme na načtení všech
    }

    if (typeof p.title === "string" || p.title === null) setTitle(p.title ?? null)
    if (p.logo) {
      setLogoCfg((old) => ({
        url: p.logo?.url ?? old.url,
        opacity: typeof p.logo?.opacity === "number" ? clamp01(p.logo.opacity) : old.opacity,
        width: typeof p.logo?.width === "number" ? p.logo.width : old.width,
        pos: p.logo?.pos || old.pos,
      }))
    }
    if (p.lights) {
      if (typeof p.lights.intensity === "number") setLightIntensity(p.lights.intensity)
      if (p.lights.headlight) {
        setHeadlightCfg((old) => ({
          enabled: typeof p.lights.headlight.enabled === "boolean" ? p.lights.headlight.enabled : old.enabled,
          intensity: typeof p.lights.headlight.intensity === "number" ? p.lights.headlight.intensity : old.intensity,
        }))
      }
    }
  }

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data
      if (!data) return
      const t = data.type
      const p = data.payload
      if (LIVE_TYPES.includes(t) && p) applyLivePayload(p)
    }
    window.addEventListener("message", onMsg)

    // HANDSHAKE → rodiči (uploaderu)
    try { window.parent?.postMessage({ type: "SHADE3D_LIVE_READY" }, "*") } catch {}

    return () => window.removeEventListener("message", onMsg)
  }, [])

  /* ---- Po načtení VŠECH modelů teprve zarámuj ---- */
  useEffect(() => {
    if (files.length > 0 && loadedCount === files.length) {
      // trigger nové zarámování
      setFrameTick((t) => t + 1)
    }
  }, [files.length, loadedCount])

  /* ---- Logo + Title overlay ---- */
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
        zIndex: 0,
        pointerEvents: "none",
        userSelect: "none",
        filter: "drop-shadow(0 0 1px rgba(0,0,0,.25))",
      }}
    />
  )

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "black" }}>
      {logoEl}

      {title && (
        <div
          title={title}
          style={{
            position: "absolute", top: 10, left: 10, zIndex: 2,
            padding: "6px 10px",
            borderRadius: 8, border: "1px solid rgba(255,255,255,.18)",
            background: "rgba(255,255,255,.08)", fontSize: 13, fontWeight: 600,
            color: "#fff", maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
          }}
        >
          {title}
        </div>
      )}

      <Canvas
        orthographic
        camera={{ position: [0, 0, 1000], near: 0.1, far: 1e7 }}
        gl={{ alpha: true }}
        onCreated={({ gl }) => gl.setClearAlpha(0)}
        style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent" }}
      >
        {!fatal && (
          <>
            {/* Scénická světla + headlight */}
            <ambientLight intensity={lightIntensity * 0.4} />
            <directionalLight position={[0, 5, 5]} intensity={lightIntensity * 1.5} />
            <directionalLight position={[-10, 0, 0]} intensity={lightIntensity * 1.0} />
            <directionalLight position={[10, 0, 0]} intensity={lightIntensity * 1.2} />
            <directionalLight position={[0, -5, -5]} intensity={lightIntensity * 0.8} />

            <Headlight enabled={headlightCfg.enabled} intensity={headlightCfg.intensity} />

            <group ref={rootRef as any}>
              <Suspense fallback={null}>
                {files.map((f, i) => (
                  <AnyModel
                    key={`${f.url}-${i}`}
                    name={f.rawName || f.name}
                    url={f.url}
                    color={colors[i] ?? "#ffffff"}
                    opacity={opacities[i] ?? 1}
                    visible={visibles[i] ?? true}
                    onLoaded={handleModelLoaded}
                    autoSmoothOn={autoSmooth}
                    smoothAngle={30}
                    roughness={roughnesses[i] ?? (typeof f.r === "number" ? f.r : 0.5)}
                    metalness={metalnesses[i] ?? (typeof f.m === "number" ? f.m : 0.5)}
                    useVertexColors={!!f.vc}
                    keepMaterials={!!f.km}
                  />
                ))}
              </Suspense>
            </group>

            {/* Zarámuje AŽ když frameTick poskočí (tj. loadedCount === files.length) */}
            <AutoCenterAndFrameOnce rootRef={rootRef} triggerKey={`frame-${files.length}-${frameTick}`} margin={1.2} />

            <OrbitControls enableDamping dampingFactor={0.12} />
          </>
        )}

        {fatal && <InlineLoader text={fatal} />}
      </Canvas>

      {/* drobný styl sliderů apod. kdybys později přidal UI */}
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
