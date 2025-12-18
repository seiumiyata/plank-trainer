import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Pose } from '@mediapipe/pose'
import { Camera } from '@mediapipe/camera_utils'

// プリセット（3セット固定）
const PRESETS = {
  beginner: { label: '初心者', workSec: 20, restSec: 30, sets: 3 },
  intermediate: { label: '中級', workSec: 45, restSec: 30, sets: 3 },
  advanced: { label: '上級', workSec: 75, restSec: 30, sets: 3 },
  custom: { label: 'カスタム', workSec: 20, restSec: 30, sets: 3 },
}

function formatMMSS(sec) {
  const s = Math.max(0, sec | 0)
  const m = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

// 3点の内角（bを頂点）を返す
function angleAt(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y
  const cbx = c.x - b.x, cby = c.y - b.y
  const dot = abx * cbx + aby * cby
  const na = Math.hypot(abx, aby) || 1
  const nc = Math.hypot(cbx, cby) || 1
  const cos = Math.min(1, Math.max(-1, dot / (na * nc)))
  return Math.acos(cos) * 180 / Math.PI
}

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const poseRef = useRef(null)
  const cameraRef = useRef(null)

  // AudioContextは使い回す（毎回newしない）
  const audioCtxRef = useRef(null)

  // タイマー（インターバル3セット自動遷移）
  const [level, setLevel] = useState('beginner')
  const [customWork, setCustomWork] = useState(20)
  const [customRest, setCustomRest] = useState(30)

  // phase: 'idle' | 'work' | 'rest' | 'done'
  const [phase, setPhase] = useState('idle')
  const [running, setRunning] = useState(false)
  const [setNo, setSetNo] = useState(1) // 1..sets
  const [remain, setRemain] = useState(0)

  // 姿勢
  const [posture, setPosture] = useState('good') // 'good' | 'bad'
  const [advice, setAdvice] = useState('')

  const config = useMemo(() => {
    const base = PRESETS[level]
    if (level !== 'custom') return base
    return {
      ...base,
      workSec: Math.max(1, Number(customWork) || 1),
      restSec: Math.max(1, Number(customRest) || 1),
    }
  }, [level, customWork, customRest])

  const ensureAudio = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  const beep = async (freq = 660, ms = 120, gainValue = 0.12) => {
    const ac = await ensureAudio()
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'sine'
    o.frequency.value = freq
    o.connect(g)
    g.connect(ac.destination)
    const now = ac.currentTime
    g.gain.setValueAtTime(gainValue, now)
    g.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000)
    o.start(now)
    o.stop(now + ms / 1000)
    o.onended = () => {
      try { o.disconnect(); g.disconnect() } catch {}
    }
  }

  const resetAll = () => {
    setRunning(false)
    setPhase('idle')
    setSetNo(1)
    setRemain(0)
  }

  const start = async () => {
    await ensureAudio() // iPhone等のため、Startのユーザー操作でAudioContextを起こす
    setSetNo(1)
    setPhase('work')
    setRemain(config.workSec)
    setRunning(true)
    beep(880, 120)
  }

  const stop = () => setRunning(false)

  // レベル変更時はリセット（暴発防止）
  useEffect(() => {
    resetAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, customWork, customRest])

  // 1秒カウント（intervalは必ず1本、cleanupする）
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setRemain((r) => r - 1)
    }, 1000)
    return () => clearInterval(id)
  }, [running])

  // フェーズ遷移（remainが-1になった瞬間に次へ）
  useEffect(() => {
    if (!running) return
    if (phase === 'idle' || phase === 'done') return
    if (remain >= 0) return

    const go = async () => {
      // フェーズ境界でチャイム
      await beep(880, 120)

      if (phase === 'work') {
        if (setNo >= config.sets) {
          setPhase('done')
          setRunning(false)
          setRemain(0)
          // 完了音（2音）
          await beep(660, 160, 0.14)
          setTimeout(() => { beep(990, 220, 0.14) }, 220)
        } else {
          setPhase('rest')
          setRemain(config.restSec)
        }
        return
      }

      if (phase === 'rest') {
        setSetNo((n) => n + 1)
        setPhase('work')
        setRemain(config.workSec)
        return
      }
    }

    go()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remain, phase, running, setNo, config.sets, config.workSec, config.restSec])

  // MediaPipe Pose 初期化
  useEffect(() => {
    const pose = new Pose({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    })
    pose.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      enableSegmentation: false,
      selfieMode: true
    })
    pose.onResults(onResults)
    poseRef.current = pose

    return () => {
      try { cameraRef.current && cameraRef.current.stop() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 結果描画 & 姿勢判定（work中だけ判定/ビープ）
  const onResults = useCallback((results) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    if (video.videoWidth && video.videoHeight) {
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
    }

    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height)

    const lm = results.poseLandmarks
    if (lm && lm.length) {
      ctx.fillStyle = '#22d3ee'
      for (const p of lm) ctx.fillRect(p.x * canvas.width - 2, p.y * canvas.height - 2, 4, 4)

      const L = { sh: lm[11], hip: lm[23], knee: lm[25] }

      // 1) 肩-腰-膝の内角 ~ 180度に近い（閾値 >= 165）
      // 2) 左右腰の縦位置差が小さい（< 5%）
      const hipAngle = angleAt(L.sh, L.hip, L.knee)
      const leftHip = lm[23], rightHip = lm[24]
      const hipDeltaY = Math.abs(leftHip.y - rightHip.y)
      const good = (hipAngle >= 165) && (hipDeltaY < 0.05)

      setPosture(good ? 'good' : 'bad')

      // 姿勢崩れビープは「work中」だけ鳴らす（休憩中に鳴ると鬱陶しいため）
      if (!good) {
        setAdvice('腰を持ち上げ、頭から踵まで一直線に！')
        if (phase === 'work' && running) {
          beep(520, 90)
        }
      } else {
        setAdvice('')
      }
    }
    ctx.restore()
  }, [phase, running])

  // カメラ開始（MediaPipe Cameraユーティリティ）
  useEffect(() => {
    const video = videoRef.current
    if (!video || !poseRef.current) return
    const cam = new Camera(video, {
      onFrame: async () => {
        await poseRef.current.send({ image: video })
      },
      width: 640,
      height: 480
    })
    cameraRef.current = cam
    cam.start()
  }, [])

  const title =
    phase === 'work'
      ? `プランク（${setNo}/${config.sets}）`
      : phase === 'rest'
        ? `休憩（次: ${setNo + 1}/${config.sets}）`
        : phase === 'done'
          ? '完了'
          : '待機中'

  const shownRemain = phase === 'idle' ? config.workSec : remain

  return (
    <div className="container">
      <div className="h1">Plank Trainer</div>

      <div className="controls">
        <div className="row">
          <select
            className="select"
            value={level}
            onChange={e => setLevel(e.target.value)}
            disabled={running}
          >
            <option value="beginner">初心者 (20秒/休30×3)</option>
            <option value="intermediate">中級 (45秒/休30×3)</option>
            <option value="advanced">上級 (75秒/休30×3)</option>
            <option value="custom">カスタム</option>
          </select>

          {level === 'custom' && (
            <>
              <input
                className="input"
                type="number"
                min="1"
                max="600"
                value={customWork}
                onChange={e => setCustomWork(e.target.value)}
                placeholder="プランク秒"
                disabled={running}
              />
              <input
                className="input"
                type="number"
                min="1"
                max="600"
                value={customRest}
                onChange={e => setCustomRest(e.target.value)}
                placeholder="休憩秒"
                disabled={running}
              />
            </>
          )}

          <button
            className="button"
            onClick={start}
            disabled={running || phase === 'work' || phase === 'rest'}
          >
            Start
          </button>
          <button className="button secondary" onClick={stop} disabled={!running}>
            Pause
          </button>
          <button className="button warn" onClick={resetAll}>
            Reset
          </button>
        </div>
      </div>

      <div className="timer">
        <span>{title} / </span>
        <span className="timerDisplay">{formatMMSS(shownRemain)}</span>
      </div>

      <div className="status">
        <div className={posture === 'good' ? 'good' : 'bad'}>
          姿勢: {posture === 'good' ? '良好' : '崩れ'}
        </div>
        {advice && <div>{advice}</div>}
      </div>

      <div className="videoWrap">
        <video ref={videoRef} playsInline className="video" />
        <canvas ref={canvasRef} />
      </div>

      <div className="note">
        Startで自動3セット進行（プランク→休憩→…）。音はWeb Audioで、初回はユーザー操作内でAudioContextをresumeしています。[web:288][web:308]
      </div>
    </div>
  )
}
