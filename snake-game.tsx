"use client"

import type React from "react"

import { useEffect, useRef, useCallback, useState } from "react"

interface Position {
  x: number
  y: number
}

type AIStatus = "idle" | "generating-joke" | "generating-speech" | "playing-audio"

const GRID_SIZE = 20
const CANVAS_WIDTH = 400
const CANVAS_HEIGHT = 400
const INITIAL_SNAKE = [{ x: 10, y: 10 }]
const INITIAL_DIRECTION = { x: 0, y: -1 }
const INITIAL_GAME_SPEED = 200

export default function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameLoopRef = useRef<NodeJS.Timeout>()
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const masterAudioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const debugTextAreaRef = useRef<HTMLTextAreaElement>(null)

  const [snake, setSnake] = useState<Position[]>(INITIAL_SNAKE)
  const [direction, setDirection] = useState<Position>(INITIAL_DIRECTION)
  const [food, setFood] = useState<Position>({ x: 15, y: 15 })
  const [gameRunning, setGameRunning] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [aiStatus, setAiStatus] = useState<AIStatus>("idle")
  const [audioEnabled, setAudioEnabled] = useState(false)
  const [showAudioPrompt, setShowAudioPrompt] = useState(true)
  const [debugLogs, setDebugLogs] = useState<string[]>([])

  // Debug logging function
  const debugLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString()
    const logMessage = `[${timestamp}] ${message}`
    console.log(logMessage)

    setDebugLogs((prev) => {
      const newLogs = [...prev, logMessage]
      return newLogs.slice(-200)
    })

    setTimeout(() => {
      if (debugTextAreaRef.current) {
        debugTextAreaRef.current.scrollTop = debugTextAreaRef.current.scrollHeight
      }
    }, 10)
  }, [])

  // Copy logs to clipboard
  const copyLogs = useCallback(async () => {
    try {
      const logsText = debugLogs.join("\n")
      await navigator.clipboard.writeText(logsText)
      debugLog("📋 Logs copied to clipboard!")
    } catch (error) {
      debugLog(`❌ Failed to copy logs: ${error}`)
    }
  }, [debugLogs, debugLog])

  // Initialize debug logging
  useEffect(() => {
    debugLog("🚀 Snake Game initialized")
    debugLog(`📱 User Agent: ${navigator.userAgent}`)
    debugLog(`🔊 Audio support: ${typeof Audio !== "undefined"}`)
    debugLog(
      `🎵 AudioContext support: ${typeof AudioContext !== "undefined" || typeof (window as any).webkitAudioContext !== "undefined"}`,
    )
  }, [debugLog])

  const generateFood = useCallback(() => {
    const maxX = CANVAS_WIDTH / GRID_SIZE
    const maxY = CANVAS_HEIGHT / GRID_SIZE
    return {
      x: Math.floor(Math.random() * maxX),
      y: Math.floor(Math.random() * maxY),
    }
  }, [])

  const checkCollision = useCallback((head: Position, snakeArray: Position[]) => {
    if (head.x < 0 || head.x >= CANVAS_WIDTH / GRID_SIZE || head.y < 0 || head.y >= CANVAS_HEIGHT / GRID_SIZE) {
      return true
    }
    for (const segment of snakeArray) {
      if (head.x === segment.x && head.y === segment.y) {
        return true
      }
    }
    return false
  }, [])

  // Enable and "prime" the master audio element on first user interaction
  const enableAudio = useCallback(async () => {
    try {
      debugLog("🔊 User clicked to enable audio...")

      // Create AudioContext
      if (!audioContextRef.current) {
        debugLog("🎵 Creating AudioContext...")
        // @ts-ignore
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (AudioContext) {
          audioContextRef.current = new AudioContext()
          debugLog(`✅ AudioContext created, state: ${audioContextRef.current.state}`)
        } else {
          debugLog("❌ AudioContext not supported")
          throw new Error("AudioContext not supported")
        }
      }

      // Resume AudioContext if suspended
      if (audioContextRef.current && audioContextRef.current.state === "suspended") {
        debugLog("⏯️ Resuming suspended AudioContext...")
        await audioContextRef.current.resume()
        debugLog(`✅ AudioContext resumed, new state: ${audioContextRef.current.state}`)
      }

      // Create and prime the single, reusable master audio element
      if (!masterAudioRef.current) {
        debugLog("🔑 Creating master audio element...")
        const audio = new Audio()
        audio.setAttribute("playsinline", "true")
        audio.setAttribute("webkit-playsinline", "true")
        audio.muted = true // Mute it so the user doesn't hear the priming play
        audio.src =
          "data:audio/mp3;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaXRyYXRlIHN1cHBseSBieSBiaXRyYXRlLmNvbQBCcm93c2VyIHN1cHBseSBieSBiaXRyYXRlLmNvbQA" // A tiny, valid mp3 file

        // Fire-and-forget the priming play. Do not await it.
        audio.play().catch((error) => {
          debugLog(`❌ Priming play threw an immediate error: ${error}. This is usually fine.`)
        })
        debugLog("▶️ Priming play initiated (fire-and-forget).")

        // Immediately continue with setup
        audio.muted = false // Unmute for future use
        masterAudioRef.current = audio
        debugLog("✅ Master audio element is created and ready!")
      }

      // Update UI immediately, without waiting for the play promise
      setAudioEnabled(true)
      setShowAudioPrompt(false)
      debugLog("✅ Audio system enabled successfully! UI updated.")
    } catch (error) {
      debugLog(`❌ Failed to enable audio system: ${error}`)
      setAudioEnabled(false)
    }
  }, [debugLog])

  const stopCurrentAudio = useCallback(() => {
    const audio = masterAudioRef.current
    if (audio && !audio.paused) {
      debugLog("🔇 Stopping current audio immediately...")
      audio.pause()
      audio.currentTime = 0
    }
    // Also cancel any pending browser speech
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel()
    }
    debugLog("✅ Audio stopped.")
  }, [debugLog])

  const generateJokeWithGroq = useCallback(
    async (snakeLength: number): Promise<string> => {
      debugLog(`🤖 Generating joke for snake length: ${snakeLength}`)
      setAiStatus("generating-joke")

      const groqApiUrl = "https://api.groq.com/openai/v1/chat/completions"
      const groqApiKey = "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"

      const prompt = `Say 1 to 3 words, only gen Z lingo like gyatt and so on, about a snake in a video game that is now ${snakeLength} blocks long`

      const groqPayload = {
        model: "gemma2-9b-it",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }

      try {
        debugLog("📡 Sending request to Groq API...")
        const groqResponse = await fetch(groqApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify(groqPayload),
        })

        if (!groqResponse.ok) {
          throw new Error(`Groq Error: ${groqResponse.statusText}`)
        }

        const groqResult = await groqResponse.json()
        const generatedText = groqResult.choices[0].message.content.trim()

        debugLog(`✅ Generated joke: "${generatedText}"`)
        return generatedText
      } catch (error) {
        debugLog(`❌ LLM Generation Failed: ${error}`)
        const fallback = `Your snake is now ${snakeLength} blocks long!`
        debugLog(`🔄 Using fallback: "${fallback}"`)
        return fallback
      }
    },
    [debugLog],
  )

  const generateGameOverComment = useCallback(
    async (score: number): Promise<string> => {
      debugLog(`💬 Generating game over comment for score: ${score}`)
      setAiStatus("generating-joke") // Reuse status for simplicity

      const groqApiUrl = "https://api.groq.com/openai/v1/chat/completions"
      const groqApiKey = "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"

      const prompt = `You are a trash-talking gamer AI. The player just lost a snake game with a final score of ${score}. Write a 5-10 word comment about their score. Be funny, a bit edgy, and use gamer lingo. For example, if the score is low, say something like 'A tiny ass score of ${score}, get good noob.' If the score is high, say 'A massive score of ${score}, you're an absolute legend!'`

      const groqPayload = {
        model: "gemma2-9b-it",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }

      try {
        debugLog("📡 Sending request to Groq API for game over comment...")
        const groqResponse = await fetch(groqApiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqApiKey}`,
          },
          body: JSON.stringify(groqPayload),
        })

        if (!groqResponse.ok) {
          throw new Error(`Groq Error: ${groqResponse.statusText}`)
        }

        const groqResult = await groqResponse.json()
        const generatedText = groqResult.choices[0].message.content.trim()

        debugLog(`✅ Generated game over comment: "${generatedText}"`)
        return generatedText
      } catch (error) {
        debugLog(`❌ Game Over Comment Generation Failed: ${error}`)
        return `Game over! Your final score was ${score}.`
      }
    },
    [debugLog],
  )

  const generateTTS = useCallback(
    async (text: string) => {
      debugLog(`🗣️ Starting TTS generation for: "${text}"`)
      setAiStatus("generating-speech")

      if (!audioEnabled || !masterAudioRef.current) {
        debugLog("❌ Audio not enabled or master element not ready, skipping TTS")
        setAiStatus("idle")
        return
      }

      // Stop any currently playing audio (from either source)
      stopCurrentAudio()

      const apiUrl = "https://api.inworld.ai/tts/v1/voice"
      const apiKey =
        "YWFpS0JkcGIyMXFrUE5NNUZQcm1SV082UDBzOEJhako6VXFNRzZkM1cwejB6VFhhNnJJeGFWNEtJY3VqbTh3SWVFRkVEVTg3eFdDWUJxTXBlSXp3Z2xicE0wSDBOUzV6Uw=="

      const headers = {
        Authorization: `Basic ${apiKey}`,
        "Content-Type": "application/json",
      }

      const payload = {
        text: text,
        voiceId: "Ashley",
        modelId: "inworld-tts-1",
      }

      try {
        debugLog("📡 Sending request to TTS API...")
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: headers,
          body: JSON.stringify(payload),
        })

        if (!response.ok) {
          throw new Error(`TTS API Error: ${response.statusText}`)
        }

        const result = await response.json()
        const audioBase64 = result.audioContent

        debugLog(`✅ TTS generated successfully, audio length: ${audioBase64.length} chars`)

        debugLog("🔄 Converting Base64 to audio blob...")
        const binaryString = atob(audioBase64)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }

        const blob = new Blob([bytes], { type: "audio/mpeg" })
        const audioUrl = URL.createObjectURL(blob)
        debugLog(`✅ Audio blob created, size: ${blob.size} bytes`)

        setAiStatus("playing-audio")

        const audio = masterAudioRef.current
        audio.volume = 1.0

        if (audio.src.startsWith("blob:")) {
          URL.revokeObjectURL(audio.src)
          debugLog("🚮 Revoked old blob URL")
        }

        const handleEnded = () => {
          debugLog("✅ Audio playback ended")
          setAiStatus("idle")
          audio.removeEventListener("ended", handleEnded)
        }
        audio.addEventListener("ended", handleEnded)

        audio.src = audioUrl
        audio.load()

        try {
          debugLog("🎵 Attempting to play audio on master element...")
          await audio.play()
          debugLog("✅ Audio started playing successfully on master element!")
        } catch (playError) {
          debugLog(`❌ Audio play failed on master element: ${playError}`)
          setAiStatus("idle")
        }
      } catch (error) {
        debugLog(`❌ TTS Generation Failed: ${error}`)
        debugLog("🔄 Attempting fallback to browser's SpeechSynthesis API...")

        if ("speechSynthesis" in window) {
          const utterance = new SpeechSynthesisUtterance(text)
          utterance.lang = "en-US"
          utterance.rate = 1.1
          utterance.pitch = 1.2

          utterance.onstart = () => {
            debugLog("✅ SpeechSynthesis started.")
            setAiStatus("playing-audio")
          }
          utterance.onend = () => {
            debugLog("✅ SpeechSynthesis finished.")
            setAiStatus("idle")
          }
          utterance.onerror = (e) => {
            debugLog(`❌ SpeechSynthesis error: ${e.error}`)
            setAiStatus("idle")
          }

          window.speechSynthesis.speak(utterance)
        } else {
          debugLog("❌ Browser SpeechSynthesis not supported. No audio will be played.")
          setAiStatus("idle")
        }
      }
    },
    [stopCurrentAudio, audioEnabled, debugLog],
  )

  const generateJokeAndSpeak = useCallback(
    async (snakeLength: number) => {
      try {
        debugLog(`🎭 Starting joke generation and speech for length: ${snakeLength}`)
        const joke = await generateJokeWithGroq(snakeLength)
        await generateTTS(joke)
      } catch (error) {
        debugLog(`❌ Failed to generate joke and speak: ${error}`)
        setAiStatus("generating-speech")
        await generateTTS(`Your snake is now ${snakeLength} blocks long!`)
      }
    },
    [generateJokeWithGroq, generateTTS, debugLog],
  )

  const generateGameOverCommentAndSpeak = useCallback(
    async (score: number) => {
      try {
        debugLog(`🎤 Starting game over comment generation for score: ${score}`)
        const comment = await generateGameOverComment(score)
        await generateTTS(comment)
      } catch (error) {
        debugLog(`❌ Failed to generate game over comment and speak: ${error}`)
        await generateTTS(`Game over! Your final score was ${score}.`)
      }
    },
    [generateGameOverComment, generateTTS, debugLog],
  )

  const moveSnake = useCallback(() => {
    if (!gameRunning || gameOver) return

    setSnake((currentSnake) => {
      const newSnake = [...currentSnake]
      const head = { x: newSnake[0].x + direction.x, y: newSnake[0].y + direction.y }

      if (checkCollision(head, newSnake)) {
        debugLog("💀 Game over - collision detected")
        setGameOver(true)
        setGameRunning(false)
        generateGameOverCommentAndSpeak(newSnake.length) // Generate comment on game over
        return currentSnake
      }

      newSnake.unshift(head)

      if (head.x === food.x && head.y === food.y) {
        const newLength = newSnake.length
        debugLog(`🍎 Food eaten! Snake length now: ${newLength}`)
        setFood(generateFood())

        generateJokeAndSpeak(newLength)
      } else {
        newSnake.pop()
      }

      return newSnake
    })
  }, [
    direction,
    food,
    gameRunning,
    gameOver,
    checkCollision,
    generateFood,
    generateJokeAndSpeak,
    generateGameOverCommentAndSpeak,
    debugLog,
  ])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    ctx.fillStyle = "#0a0a0a"
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"
    ctx.lineWidth = 0.5
    for (let i = 0; i <= CANVAS_WIDTH; i += GRID_SIZE) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, CANVAS_HEIGHT)
      ctx.stroke()
    }
    for (let i = 0; i <= CANVAS_HEIGHT; i += GRID_SIZE) {
      ctx.beginPath()
      ctx.moveTo(0, i)
      ctx.lineTo(CANVAS_WIDTH, i)
      ctx.stroke()
    }

    snake.forEach((segment, index) => {
      const x = segment.x * GRID_SIZE
      const y = segment.y * GRID_SIZE

      if (index === 0) {
        ctx.shadowColor = "#ffffff"
        ctx.shadowBlur = 20
        ctx.fillStyle = "#ffffff"
      } else {
        ctx.shadowColor = "#cccccc"
        ctx.shadowBlur = 10
        ctx.fillStyle = "#e0e0e0"
      }

      ctx.fillRect(x + 2, y + 2, GRID_SIZE - 4, GRID_SIZE - 4)
      ctx.shadowBlur = 0
    })

    const pulseIntensity = Math.sin(Date.now() * 0.01) * 0.3 + 0.7
    ctx.shadowColor = "#00ff88"
    ctx.shadowBlur = 25 * pulseIntensity
    ctx.fillStyle = "#00ff88"
    const foodX = food.x * GRID_SIZE
    const foodY = food.y * GRID_SIZE
    ctx.beginPath()
    ctx.arc(foodX + GRID_SIZE / 2, foodY + GRID_SIZE / 2, (GRID_SIZE - 6) / 2, 0, 2 * Math.PI)
    ctx.fill()
    ctx.shadowBlur = 0
  }, [snake, food])

  const changeDirection = useCallback((newDirection: Position) => {
    setDirection((current) => {
      if (newDirection.x === -current.x && newDirection.y === -current.y) {
        return current
      }
      return newDirection
    })
  }, [])

  const startGame = useCallback(() => {
    debugLog("🎮 Starting game...")
    setGameRunning(true)
    setGameOver(false)
  }, [debugLog])

  const resetGame = useCallback(() => {
    debugLog("🔄 Resetting game...")

    if (masterAudioRef.current) {
      masterAudioRef.current.pause()
      debugLog("🔇 Master audio stopped")
    }

    setSnake(INITIAL_SNAKE)
    setDirection(INITIAL_DIRECTION)
    setFood(generateFood())
    setGameOver(false)
    setGameRunning(false)
    setAiStatus("idle")
  }, [generateFood, debugLog])

  // Handle all interactions
  const handleInteraction = useCallback(
    (event: any) => {
      event.preventDefault()
      event.stopPropagation()

      debugLog(`👆 Interaction detected - gameRunning: ${gameRunning}, gameOver: ${gameOver}, aiStatus: ${aiStatus}`)

      if (gameOver) {
        // If AI is busy, don't reset. Let it finish speaking.
        if (aiStatus !== "idle") {
          debugLog("🎤 AI is busy, reset is deferred. Please tap again after the sound finishes.")
          return
        }
        resetGame()
      } else if (!gameRunning) {
        startGame()
      }
    },
    [gameRunning, gameOver, startGame, resetGame, debugLog, aiStatus],
  )

  // Handle swipe
  const handleTouchStart = useCallback(
    (event: TouchEvent | React.TouchEvent) => {
      event.preventDefault()
      const touch = "touches" in event ? event.touches[0] : event.changedTouches[0]
      touchStartRef.current = { x: touch.clientX, y: touch.clientY }
      debugLog("👆 Touch start detected")
    },
    [debugLog],
  )

  const handleTouchEnd = useCallback(
    (event: TouchEvent | React.TouchEvent) => {
      event.preventDefault()

      if (!gameRunning) {
        handleInteraction(event)
        return
      }

      if (!touchStartRef.current) return

      const touch = "changedTouches" in event ? event.changedTouches[0] : event.touches[0]
      const deltaX = touch.clientX - touchStartRef.current.x
      const deltaY = touch.clientY - touchStartRef.current.y
      const minSwipeDistance = 30

      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (Math.abs(deltaX) > minSwipeDistance) {
          const newDir = deltaX > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 }
          debugLog(`👆 Swipe horizontal: ${deltaX > 0 ? "right" : "left"}`)
          changeDirection(newDir)
        }
      } else {
        if (Math.abs(deltaY) > minSwipeDistance) {
          const newDir = deltaY > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 }
          debugLog(`👆 Swipe vertical: ${deltaY > 0 ? "down" : "up"}`)
          changeDirection(newDir)
        }
      }

      touchStartRef.current = null
    },
    [gameRunning, handleInteraction, changeDirection, debugLog],
  )

  // Prevent scrolling
  useEffect(() => {
    const preventDefault = (e: Event) => e.preventDefault()

    document.body.style.overflow = "hidden"
    document.body.style.position = "fixed"
    document.body.style.width = "100%"
    document.body.style.height = "100%"

    document.addEventListener("touchmove", preventDefault, { passive: false })
    document.addEventListener("wheel", preventDefault, { passive: false })

    return () => {
      document.body.style.overflow = ""
      document.body.style.position = ""
      document.body.style.width = ""
      document.body.style.height = ""
      document.removeEventListener("touchmove", preventDefault)
      document.removeEventListener("wheel", preventDefault)
    }
  }, [])

  // Add keyboard controls
  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (!gameRunning) return

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault()
          changeDirection({ x: 0, y: -1 })
          break
        case "ArrowDown":
          event.preventDefault()
          changeDirection({ x: 0, y: 1 })
          break
        case "ArrowLeft":
          event.preventDefault()
          changeDirection({ x: -1, y: 0 })
          break
        case "ArrowRight":
          event.preventDefault()
          changeDirection({ x: 1, y: 0 })
          break
        case " ":
          event.preventDefault()
          if (gameOver) {
            resetGame()
          } else if (!gameRunning) {
            startGame()
          }
          break
      }
    }

    window.addEventListener("keydown", handleKeyPress)
    return () => window.removeEventListener("keydown", handleKeyPress)
  }, [gameRunning, gameOver, changeDirection, startGame, resetGame])

  // Game loop
  useEffect(() => {
    if (gameRunning) {
      const currentSpeed = Math.max(80, INITIAL_GAME_SPEED - (snake.length - 1) * 8)
      gameLoopRef.current = setInterval(moveSnake, currentSpeed)
    } else {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }

    return () => {
      if (gameLoopRef.current) {
        clearInterval(gameLoopRef.current)
      }
    }
  }, [gameRunning, moveSnake, snake.length])

  // Draw
  useEffect(() => {
    draw()
  }, [draw])

  // Get AI status indicator styles
  const getAIIndicatorStyles = () => {
    const baseClasses = "absolute top-4 left-4 w-4 h-4 rounded-full shadow-lg transition-all duration-300"

    switch (aiStatus) {
      case "generating-joke":
        return `${baseClasses} bg-orange-500 animate-pulse shadow-orange-500/50`
      case "generating-speech":
        return `${baseClasses} bg-yellow-500 animate-pulse shadow-yellow-500/50`
      case "playing-audio":
        return `${baseClasses} bg-green-500 animate-pulse shadow-green-500/50`
      default:
        return `${baseClasses} bg-gray-600 opacity-30`
    }
  }

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-gray-900 via-black to-gray-900 flex flex-col">
      {/*<div className="absolute top-2 left-2 right-2 h-64 text-xs text-green-400 font-mono z-50 flex flex-col pointer-events-none">
        <div className="p-2 text-white font-bold flex justify-between items-center pointer-events-auto [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
          <span>Debug Logs ({debugLogs.length})</span>
          <div className="flex gap-2">
            <button
              onClick={copyLogs}
              className="bg-black/40 text-blue-400 hover:text-blue-300 text-xs px-2 py-1 border border-blue-400 rounded"
            >
              📋 Copy
            </button>
            <button
              onClick={() => setDebugLogs([])}
              className="bg-black/40 text-red-400 hover:text-red-300 text-xs px-2 py-1 border border-red-400 rounded"
            >
              Clear
            </button>
          </div>
        </div>
        <textarea
          ref={debugTextAreaRef}
          value={debugLogs.join("\n")}
          readOnly
          className="flex-1 bg-transparent text-green-400 font-mono text-xs p-2 resize-none outline-none border-none pointer-events-auto [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]"
          style={{
            fontFamily: "monospace",
            lineHeight: "1.2",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
          }}
          placeholder="No logs yet..."
        />
      </div>*/}

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md mx-auto px-4">
          <div className="bg-black/50 backdrop-blur-sm border border-gray-700 p-4 shadow-2xl rounded-lg">
            <div className="relative">
              {/* AI Status Indicator */}
              <div className={getAIIndicatorStyles()} />

              {/* Audio Status Indicator */}
              {!audioEnabled && <div className="absolute top-4 right-4 text-xs text-red-400">Audio Disabled</div>}
              {audioEnabled && <div className="absolute top-4 right-4 text-xs text-green-400">Audio Ready</div>}

              <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="w-full max-w-full border border-gray-700 rounded-lg shadow-lg cursor-pointer"
                onClick={handleInteraction}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
                style={{ touchAction: "none" }}
              />

              {/* Audio Enable Prompt */}
              {showAudioPrompt && (
                <div className="absolute inset-0 bg-black/90 backdrop-blur-sm rounded-lg flex items-center justify-center">
                  <div className="text-center p-6">
                    <div className="text-2xl font-bold text-white mb-4">🔊 Enable Audio</div>
                    <div className="text-white text-sm mb-6">
                      Click to enable AI voice commentary for your snake game!
                    </div>
                    <button
                      onClick={enableAudio}
                      className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all duration-200 transform hover:scale-105"
                    >
                      🎵 Enable Audio & Play
                    </button>
                    <div className="text-xs text-gray-400 mt-4">
                      You'll hear AI-generated jokes when your snake grows!
                    </div>
                  </div>
                </div>
              )}

              {gameOver && !showAudioPrompt && (
                <div
                  className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-lg flex items-center justify-center cursor-pointer"
                  onClick={handleInteraction}
                  onTouchEnd={handleInteraction}
                >
                  <div className="text-center">
                    <div className="text-3xl font-bold text-white mb-4">GAME OVER</div>
                    {aiStatus !== "idle" ? (
                      <div className="text-yellow-400 text-lg animate-pulse">The AI is speaking...</div>
                    ) : (
                      <div className="text-white text-lg">Tap to restart</div>
                    )}
                  </div>
                </div>
              )}

              {!gameRunning && !gameOver && !showAudioPrompt && (
                <div
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-lg flex items-center justify-center cursor-pointer"
                  onClick={handleInteraction}
                  onTouchEnd={handleInteraction}
                >
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">Tap to start</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
