"use client"

import * as React from "react"
import * as THREE from "three"
import { Canvas } from "@react-three/fiber"
import { OrbitControls } from "@react-three/drei"

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v))
}

function stripExt(name: string) {
  return name.replace(/\.[^/.]+$/, "")
}

export default function Shade3DViewer() {
  const [files, setFiles] = React.useState<any[]>([])
  const [title, setTitle] = React.useState<string | null>(null)
  const [logoCfg, setLogoCfg] = React.useState({
    url: null as string | null,
    opacity: 0.9,
    width: 160,
    pos: "bc" as "bl" | "bc" | "br",
  })
  const [lightIntensity, setLightIntensity] = React.useState(1)
  const [headlightCfg, setHeadlightCfg] = React.useState({
    enabled: true,
    intensity: 2,
  })

  const prevFileKeysRef = React.useRef<string[]>([])

  /** ────────── apply incoming payload ────────── */
  const applyLivePayload = (p: any) => {
    if (!p) return

    // 1️⃣ files (optional)
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

      if (changed) {
        console.log("Loaded new files:", newFiles.map(f => f.name))
      }
    }

    // 2️⃣ title / logo
    if (typeof p.title === "string" || p.title === null)
      setTitle(p.title ?? null)

    if (p.logo) {
      setLogoCfg(old => ({
        url: p.logo?.url ?? old.url,
        opacity:
          typeof p.logo?.opacity === "number"
            ? clamp01(p.logo.opacity)
            : old.opacity,
        width:
          typeof p.logo?.width === "number"
            ? p.logo.width
            : old.width,
        pos: p.logo?.pos || old.pos,
      }))
    }

    // 3️⃣ lights
    if (p.lights) {
      if (typeof p.lights.intensity === "number")
        setLightIntensity(p.lights.intensity)
      if (p.lights.headlight) {
        setHeadlightCfg(old => ({
          enabled:
            typeof p.lights.headlight.enabled === "boolean"
              ? p.lights.headlight.enabled
              : old.enabled,
          intensity:
            typeof p.lights.headlight.intensity === "number"
              ? p.lights.headlight.intensity
              : old.intensity,
        }))
      }
    }
  }

  /** ────────── listener + handshake ────────── */
  React.useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data
      if (!data) return
      const t = data.type
      const p = data.payload
      if (
        (t === "SHADE3D_LIVE" ||
          t === "SHADE3D_LIVE_V6" ||
          t === "SHADE3D_LIVE_V5") &&
        p
      ) {
        applyLivePayload(p)
      }
    }

    window.addEventListener("message", onMsg)

    // HANDSHAKE
    try {
      window.parent?.postMessage({ type: "SHADE3D_LIVE_READY" }, "*")
    } catch {}

    return () => window.removeEventListener("message", onMsg)
  }, [])

  /** ────────── basic renderer ────────── */
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#000",
        color: "#fff",
        position: "relative",
      }}
    >
      <Canvas camera={{ position: [0, 0, 6], fov: 45 }}>
        <ambientLight intensity={lightIntensity} />
        {headlightCfg.enabled && (
          <directionalLight
            intensity={headlightCfg.intensity}
            position={[0, 0, 2]}
          />
        )}
        <OrbitControls />
        {files.map((f, i) => (
          <mesh key={i} visible={f.v}>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial
              color={f.c || "#888"}
              transparent={true}
              opacity={f.o}
              roughness={f.r}
              metalness={f.m}
            />
          </mesh>
        ))}
      </Canvas>

      {title && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          {title}
        </div>
      )}

      {logoCfg.url && (
        <img
          src={logoCfg.url}
          alt="logo"
          style={{
            position: "absolute",
            bottom: 16,
            left:
              logoCfg.pos === "bl"
                ? 16
                : logoCfg.pos === "bc"
                ? "50%"
                : "auto",
            right: logoCfg.pos === "br" ? 16 : "auto",
            transform: logoCfg.pos === "bc" ? "translateX(-50%)" : "none",
            width: logoCfg.width,
            opacity: logoCfg.opacity,
          }}
        />
      )}
    </div>
  )
}
