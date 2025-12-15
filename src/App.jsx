import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Pose, POSE_CONNECTIONS } from '@mediapipe/pose'
import { Camera } from '@mediapipe/camera_utils'

// レベル別プリセット秒数
const PRESETS = {
  beginner: 20,
  intermediate: 60,
  advanced: 120
}

function formatMMSS(sec) {
  const s = Math.max(0, sec|0)
  const m = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${m}:${ss}`
}

// 2点間の角度(度)を返す（x右+、y下+座標）: 水平基準の角度
function angleDeg(x1, y1, x2, y2) {
  return Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
}

// 3点の内角（bを頂点）を返す
function angleAt(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y
  const cbx = c.x - b.x, cby = c.y - b.y
  const dot = abx*cbx + aby*cby
  const na = Math.hypot(abx, aby) || 1
  const nc = Math.hypot(cbx, cby) || 1
  const cos = Math.min(1, Math.max(-1, dot/(na*nc)))
  return Math.acos(cos) * 180 / Math.PI
}

export default function App() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const poseRef = useRef(null)
  const cameraRef = useRef(null)

  // タイマー/姿勢状態
  const [level, setLevel] = useState('beginner')
  const [custom, setCustom] = useState(30)
  const [target, setTarget] = useState(PRESETS.beginner)
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [posture, setPosture] = useState('good') // 'good' | 'bad'
  const [advice, setAdvice] = useState('')

  // タイマー
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setElapsed(t => {
        const next = t + 1
        if (next >= target) {
          setRunning(false)
          beep(880, 150)
        }
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [running, target])

  // レベル変更
  useEffect(() => {
    if (level === 'custom') setTarget(Number(custom) || 1)
    else setTarget(PRESETS[level])
    setElapsed(0)
    setRunning(false)
  }, [level, custom])

  // チャイム
  const beep = (freq = 660, ms = 120) => {
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    const o = ac.createOscillator()
    const g = ac.createGain()
    o.type = 'sine'; o.frequency.value = freq
    o.connect(g); g.connect(ac.destination)
    o.start()
    g.gain.setValueAtTime(0.12, ac.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + ms/1000)
    setTimeout(() => { o.stop(); ac.close() }, ms + 50)
  }

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
      // cleanup
      try { cameraRef.current && cameraRef.current.stop() } catch {}
    }
  }, [])

  // 結果描画 & 姿勢判定
  const onResults = useCallback((results) => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    // 動画サイズにキャンバスをフィット
    if (video.videoWidth && video.videoHeight) {
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight
    }

    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.clearRect(0,0,canvas.width,canvas.height)
    ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height)

    const lm = results.poseLandmarks
    if (lm && lm.length) {
      // 描画
      // 動的import不要の描画: シンプルに点を打つ
      ctx.fillStyle = '#22d3ee'
      for (const p of lm) ctx.fillRect(p.x*canvas.width-2, p.y*canvas.height-2, 4, 4)
      // ライン（肩-腰-膝）左側
      const L = { sh: lm[11], hip: lm[23], knee: lm[25], ank: lm[27] }
      ctx.strokeStyle = '#34d399'; ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(L.sh.x*canvas.width, L.sh.y*canvas.height)
      ctx.lineTo(L.hip.x*canvas.width, L.hip.y*canvas.height)
      ctx.lineTo(L.knee.x*canvas.width, L.knee.y*canvas.height)
      ctx.stroke()

      // 簡易プランク判定:
      // 1) 肩-腰-膝の内角 ~ 180度に近い（閾値 >= 165）
      // 2) 左右腰の縦位置差が小さい（< 5%）
      const hipAngle = angleAt(L.sh, L.hip, L.knee) // 180が一直線
      const leftHip = lm[23], rightHip = lm[24]
      const hipDeltaY = Math.abs(leftHip.y - rightHip.y)
      const good = (hipAngle >= 165) && (hipDeltaY < 0.05)

      setPosture(good ? 'good' : 'bad')
      if (!good) {
        setAdvice('腰を持ち上げ、頭から踵まで一直線に！')
        beep(520, 90)
      } else {
        setAdvice('')
      }
    }
    ctx.restore()
  }, [])

  // カメラ開始（MediaPipeのCameraユーティリティで起動）
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
  }, [videoRef, poseRef])

  return (
    <div className="container">
      <div className="h1">Plank Trainer</div>

      <div className="controls">
        <div className="row">
          <select className="select" value={level} onChange={e => setLevel(e.target.value)}>
            <option value="beginner">初心者 (20秒)</option>
            <option value="intermediate">中級 (60秒)</option>
            <option value="advanced">上級 (120秒)</option>
            <option value="custom">カスタム</option>
          </select>

          {level === 'custom' && (
            <input
              className="input"
              type="number"
              min="1"
              max="600"
              value={custom}
              onChange={e => setCustom(e.target.value)}
              placeholder="秒数 (1-600)"
            />
          )}

          <button className="button" onClick={() => { setElapsed(0); setRunning(true); }}>
            Start
          </button>
          <button className="button secondary" onClick={() => setRunning(false)}>
            Stop
          </button>
          <button className="button warn" onClick={() => { setRunning(false); setElapsed(0); }}>
            Reset
          </button>
        </div>
      </div>

      <div className="timer">
        <span>目標: {formatMMSS(target)} / </span>
        <span className="timerDisplay">{formatMMSS(target - elapsed)}</span>
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
        ヒント: iPhone/AndroidはこのページをHTTPSで開き、カメラ権限を許可してください。横向き設置で全身が映る距離がおすすめ。
      </div>
    </div>
  )
}
