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
const ICONS = { eye: "/icons/Eye.png", eyeOff: "/icons/Eye-off.png" }
function PreloadIcons() {
  useEffect(() => { Object.values(ICONS).forEach((src) => { const img = new Image(); img.decoding = "async"; img.src = src }) }, [])
  return null
}

/* ---------- Helpers ---------- */
const DEFAULT_LOGO = "/Arthetic_logo.png"
const stripExt = (s) => s?.replace(/\.[^.]+$/, "") || ""
const clamp01 = (x) => Math.max(0, Math.min(1, x))
const getParam = (name) => { if (typeof window === "undefined") return null; return new URL(window.location.href).searchParams.get(name) }
async function fetchJSON(url) { const r = await fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() }
function inferExt(nameOrUrl) { if (!nameOrUrl) return ""; const s = nameOrUrl.split("?")[0]; const m = s.match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : "" }

/* ---------- Lightbox ---------- */
function Lightbox({ items, index, onClose, onChange }) {
  // items: [{u,n,w,h}]
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowRight") onChange((index + 1) % items.length)
      if (e.key === "ArrowLeft") onChange((index - 1 + items.length) % items.length)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [index, items.length, onClose, onChange])

  const it = items[index]
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.85)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 12,
    }}>
      <img
        src={it.u}
        alt={it.n || ""}
        style={{ maxWidth: "96vw", maxHeight: "92vh", objectFit: "contain", boxShadow: "0 8px 40px rgba(0,0,0,.6)", borderRadius: 12 }}
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        style={{ position: "fixed", top: 10, right: 12, zIndex: 60, border: "1px solid rgba(255,255,255,.35)", background: "rgba(0,0,0,.3)", color: "white", padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}
      >
        Zavřít
      </button>
    </div>
  )
}

/* ---------- Auto Smooth (beze změn) ---------- */
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
  for (let i = 0; i < vCount; i++) { const k = keyOf(i); let arr = groups.get(k); if (!arr) { arr = []; groups.set(k, arr) } arr.push(i) }
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
      tmp.set(nx, ny, nz); if (tmp.lengthSq() === 0) tmp.copy(nRef); tmp.normalize()
      const w = ci * 3; normals[w] = tmp.x; normals[w + 1] = tmp.y; normals[w + 2] = tmp.z
    }
  })
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
  g.computeBoundingBox(); g.computeBoundingSphere()
  return g
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

/* ---------- AnyModel (beze změn) ---------- */
function AnyModel({ name, url, color, opacity, visible, onLoaded, autoSmooth, smoothAngle, roughness = 0.5, metalness = 0.5, useVertexColors = false, keepMaterials = false }) {
  // ... beze změn jako v tvém kódu ...
  // kvůli délce nezopakuji – ponech svůj původní AnyModel
  // (pokud chceš, zkopíruj sem 1:1 svůj stávající blok)
  return null
}

/* ---------- Headlight / Trackball / AutoCenterAndFrame – beze změn ---------- */
// ... (ponech stejné jako v původním kódu) ...

/* ---------- ClientPage (Viewer) ---------- */
export default function ClientPage() {
  const [lightIntensity, setLightIntensity] = useState(1)
  const [lightPos1] = useState({ x: 0, y: 5, z: 5 })
  const [lightPos2] = useState({ x: -10, y: 0, z: 0 })
  const [lightPos3] = useState({ x: 10, y: 0, z: 0 })
  const [lightPos4] = useState({ x: 0, y: -5, z: -5 })
  const [headlightCfg, setHeadlightCfg] = useState({ enabled: true, intensity: 2.0 })

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
  const [files, setFiles] = useState([]) // {url,name,rawName,c,o,v,r,m,vc,km}
  const [colors, setColors] = useState([])
  const [opacities, setOpacities] = useState([])
  const [visibles, setVisibles] = useState([])
  const [roughnesses, setRoughnesses] = useState([])
  const [metalnesses, setMetalnesses] = useState([])
  const [fatal, setFatal] = useState(null)

  // [PHOTOS] – fotky do galerie
  const [photos, setPhotos] = useState([]) // [{u,n,w,h}]
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // auto smooth
  const [autoSmooth, setAutoSmooth] = useState((getParam("smooth") ?? "1") !== "0")
  const [smoothAngle, setSmoothAngle] = useState(() => {
    const v = parseFloat(getParam("smoothAngle") ?? "30")
    return isFinite(v) ? Math.max(0, Math.min(80, v)) : 30
  })

  const [logoCfg, setLogoCfg] = useState({ url: DEFAULT_LOGO, opacity: 0.9, width: 160, pos: "bc" })

  const [cameraTarget, setCameraTarget] = useState([0, 0, 0])
  const [loadedCount, setLoadedCount] = useState(0)
  const handleModelLoaded = () => setLoadedCount((n) => n + 1)

  const centerParam = (getParam("center") || "combined").toLowerCase()
  const centerMode = ["per", "combined", "none"].includes(centerParam) ? centerParam : "combined"

  // init – načti manifest / files / photos
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
          const logoUrl = m?.logo?.url || DEFAULT_LOGO
          setLogoCfg({
            url: logoUrl || null,
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10),
            pos: getParam("logoPos") || "bc",
          })

          // [PHOTOS] z manifestu
          const Ph = Array.isArray(m?.photos) ? m.photos.filter((p) => p && p.u) : []
          setPhotos(Ph)

          // headlight
          const hl = m?.lights?.headlight
          if (hl && typeof hl === "object") {
            setHeadlightCfg({ enabled: typeof hl.enabled === "boolean" ? hl.enabled : true, intensity: typeof hl.intensity === "number" ? hl.intensity : 2.0 })
          } else {
            const qOn = getParam("headlight")
            const qI = parseFloat(getParam("headlightI") ?? "NaN")
            setHeadlightCfg({ enabled: qOn == null ? true : qOn !== "0", intensity: isFinite(qI) ? qI : 2.0 })
          }
          return
        }

        // URL param files (a případné photos)
        const f = getParam("files")
        if (f) {
          let arr = null; try { arr = JSON.parse(f) } catch {}
          if (!arr) { try { arr = JSON.parse(decodeURIComponent(f)) } catch {} }
          if (!Array.isArray(arr)) throw new Error("Neplatný formát parametru ?files=")
          const Fs = arr.filter((x) => x && x.u).map((x, i) => ({
            url: x.u, name: stripExt(x.n) || `Model ${i + 1}`, rawName: x.n, c: x.c,
            o: typeof x.o === "number" ? x.o : 1, v: typeof x.v === "boolean" ? x.v : true,
            r: typeof x.r === "number" ? x.r : 0.5, m: typeof x.m === "number" ? x.m : 0.5, vc: !!x.vc, km: !!x.km,
          }))
          setFiles(Fs)
          const palette = ["#f5f5dc", "#8e8e8e", "#ffffff", "#ffd7a8", "#c0c0c0", "#e6f0ff", "#ffeedd"]
          setColors(Fs.map((f, i) => f.c || palette[i % palette.length]))
          setOpacities(Fs.map((f) => (typeof f.o === "number" ? clamp01(f.o) : 1)))
          setVisibles(Fs.map((f) => (typeof f.v === "boolean" ? f.v : true)))
          setRoughnesses(Fs.map((f) => (typeof f.r === "number" ? clamp01(f.r) : 0.5)))
          setMetalnesses(Fs.map((f) => (typeof f.m === "number" ? clamp01(f.m) : 0.5)))

          setTitle(getParam("title") ?? null)
          setLogoCfg({
            url: getParam("logo") === "none" ? null : getParam("logo") || DEFAULT_LOGO,
            opacity: clamp01(parseFloat(getParam("logoOpacity") ?? "0.9")),
            width: parseInt(getParam("logoWidth") ?? (window.innerWidth < 768 ? "120" : "160"), 10),
            pos: getParam("logoPos") || "bc",
          })

          // [PHOTOS] z URL parametru
          const p = getParam("photos")
          if (p) {
            let parr = null
            try { parr = JSON.parse(p) } catch {}
            if (!parr) { try { parr = JSON.parse(decodeURIComponent(p)) } catch {} }
            if (Array.isArray(parr)) setPhotos(parr.filter((x) => x && x.u))
          }

          const qOn = getParam("headlight"); const qI = parseFloat(getParam("headlightI") ?? "NaN")
          setHeadlightCfg({ enabled: qOn == null ? true : qOn !== "0", intensity: isFinite(qI) ? qI : 2.0 })
          return
        }

        // dev fallback (beze změn)
        // ... (ponech svůj fallback pokud ho chceš) ...
      } catch (e) {
        console.error(e)
        setFatal("Tento náhled není dostupný (chyba při načtení dat).")
      }
    })()
  }, [])

  // LOGO element
  const logoEl = logoCfg.url && (
    <img src={logoCfg.url} alt="" style={{
      position: "absolute", bottom: logoCfg.pos === "bc" || logoCfg.pos === "bl" || logoCfg.pos === "br" ? 12 : "auto",
      left: logoCfg.pos === "bl" ? 12 : logoCfg.pos === "bc" ? "50%" : "auto",
      right: logoCfg.pos === "br" ? 12 : "auto", transform: logoCfg.pos === "bc" ? "translateX(-50%)" : "none",
      width: logoCfg.width, opacity: logoCfg.opacity, zIndex: 0, pointerEvents: "none", userSelect: "none", filter: "drop-shadow(0 0 1px rgba(0,0,0,.25))",
    }} />
  )

  const rootRef = useRef()
  const fillDim = headlightCfg.enabled ? 0.5 : 1

  /** ---------- UI: panel s miniaturami fotek ---------- */
  const photosPanel = photos.length > 0 && !isMobile && (
    <div
      style={{
        position: "absolute", top: 10, left: 10, bottom: 10, width: 86,
        display: "flex", flexDirection: "column", gap: 8, overflow: "auto",
        padding: 8, borderRadius: 10, border: "1px solid rgba(255,255,255,.15)",
        background: "rgba(0,0,0,.25)", backdropFilter: "blur(3px)", zIndex: 2,
      }}
    >
      <div style={{ color: "white", fontSize: 12, opacity: .9, marginBottom: 4, fontWeight: 600 }}>Foto</div>
      {photos.map((p, i) => (
        <button
          key={i}
          onClick={() => { setLightboxIndex(i); setLightboxOpen(true) }}
          title={p.n || `Foto ${i + 1}`}
          style={{
            width: "100%", aspectRatio: "1/1", borderRadius: 8, overflow: "hidden",
            border: "1px solid rgba(255,255,255,.18)", background: "#000", padding: 0, cursor: "pointer"
          }}
        >
          <img src={p.u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        </button>
      ))}
    </div>
  )

  /** ---------- UI: mobilní FAB „Foto“ ---------- */
  const photosFAB = photos.length > 0 && isMobile && (
    <button
      onClick={() => { setLightboxIndex(0); setLightboxOpen(true) }}
      style={{
        position: "absolute", left: 12, bottom: 12, zIndex: 2,
        padding: "10px 14px", borderRadius: 999, border: "1px solid rgba(255,255,255,.3)",
        background: "rgba(0,0,0,.35)", color: "white", fontWeight: 700, cursor: "pointer", backdropFilter: "blur(3px)"
      }}
      aria-label="Otevřít fotky"
    >
      Foto
    </button>
  )

  return (
    <div className="stage" style={{ position: "relative", width: "100vw", height: "100vh", background: "black" }}>
      <PreloadIcons />
      {logoEl}
      {photosPanel}
      {photosFAB}

      {/* Původní ovládací panel (barvy/opacity/AutoSmooth) – posunut doprava, aby se nebil s fotkami */}
      <div
        className="controls-panel"
        style={{
          position: "absolute",
          top: 10,
          left: isMobile ? 8 : 110, // posun kvůli fotopanelu
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
          padding: "8px 10px",
          width: "clamp(240px, 30vw, 420px)",
          maxWidth: "calc(100vw - 20px)",
          boxSizing: "border-box",
        }}
      >
        {/* ... tvůj původní obsah panelu (titulek, řádky pro soubory, AutoSmooth) – beze změn ... */}
      </div>

      {/* CANVAS */}
      <Canvas orthographic camera={{ position: [0, 0, 100], near: 0.01, far: 100000 }} gl={{ alpha: true }} onCreated={({ gl }) => gl.setClearAlpha(0)} style={{ position: "absolute", inset: 0, zIndex: 1, background: "transparent" }}>
        {!fatal && (
          <>
            <ambientLight intensity={lightIntensity * 0.4 * fillDim} />
            <directionalLight position={[lightPos1.x, lightPos1.y, lightPos1.z]} intensity={lightIntensity * 1.5 * fillDim} />
            <directionalLight position={[lightPos2.x, lightPos2.y, lightPos2.z]} intensity={lightIntensity * 1.0 * fillDim} />
            <directionalLight position={[lightPos3.x, lightPos3.y, lightPos3.z]} intensity={lightIntensity * 1.2 * fillDim} />
            <directionalLight position={[lightPos4.x, lightPos4.y, lightPos4.z]} intensity={lightIntensity * 0.8 * fillDim} />
            <Headlight enabled={headlightCfg.enabled} intensity={headlightCfg.intensity} />

            <group ref={rootRef}>
              <Suspense fallback={null}>
                {files.map((f, i) => (
                  <AnyModel key={i} name={f.rawName || f.name} url={f.url}
                            color={colors[i] ?? "#ffffff"} opacity={opacities[i] ?? 1}
                            visible={visibles[i] ?? true} onLoaded={() => {}}
                            autoSmooth={autoSmooth} smoothAngle={smoothAngle}
                            roughness={roughnesses[i] ?? (typeof f.r === "number" ? f.r : 0.5)}
                            metalness={metalnesses[i] ?? (typeof f.m === "number" ? f.m : 0.5)}
                            useVertexColors={!!f.vc} keepMaterials={!!f.km} />
                ))}
              </Suspense>
            </group>

            {/* Auto center/frame + ovládání */}
            {/* ... (ponech své komponenty AutoCenterAndFrame + Trackball) ... */}
          </>
        )}
      </Canvas>

      {/* LIGHTBOX */}
      {lightboxOpen && photos.length > 0 && (
        <Lightbox
          items={photos}
          index={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          onChange={(i) => setLightboxIndex(i)}
        />
      )}

      {/* Globální styly – jen drobná úprava pro responsivitu panelu */}
      <style jsx global>{`
        .slider { appearance: none; height: 14px; background: transparent; margin: 5px 0; display: inline-block; }
        .slider::-webkit-slider-runnable-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-webkit-slider-thumb { appearance: none; width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; margin-top: -5px; }
        .slider::-moz-range-track { height: 4px; background: white; border-radius: 2px; }
        .slider::-moz-range-thumb { width: 14px; height: 14px; border-radius: 50%; background: white; cursor: pointer; box-shadow: 0 0 2px black; border: none; }

        @media (max-width: 720px) {
          .controls-panel { left: 8px !important; right: 8px; width: auto !important; max-width: calc(100vw - 16px) !important; }
        }
      `}</style>
    </div>
  )
}
