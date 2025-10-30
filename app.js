// LST - MediaRecorder Pipeline
// VP9/VP8 fallback, timesliced 100ms, auto-stop on audio end

let audioContext;
let analyser;
let audioSource;
let audioElement;
let mediaRecorder;
let recordedChunks = [];
let canvas;
let canvasContext;
let animationId;
let mediaStream;
let isRecording = false;

const statusEl = document.getElementById('status');
const uploadBtn = document.getElementById('uploadBtn');
const audioFileInput = document.getElementById('audioFile');
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadBtn = document.getElementById('downloadBtn');

// Initialize canvas
function initCanvas() {
    canvas = document.getElementById('visualizer');
    canvasContext = canvas.getContext('2d');
    canvas.width = 800;
    canvas.height = 400;
}

// Draw initial frame before captureStream
function drawInitialFrame() {
    canvasContext.fillStyle = '#000';
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);
    
    canvasContext.strokeStyle = '#0f0';
    canvasContext.lineWidth = 2;
    canvasContext.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    
    canvasContext.fillStyle = '#0f0';
    canvasContext.font = '20px Courier New';
    canvasContext.textAlign = 'center';
    canvasContext.fillText('LST - Ready to Record', canvas.width / 2, canvas.height / 2);
}

// Upload audio file
audioFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
        statusEl.textContent = `Loading: ${file.name}`;
        
        // Create audio element
        if (audioElement) {
            audioElement.pause();
            if (audioElement.src) {
                URL.revokeObjectURL(audioElement.src);
            }
            audioElement.src = '';
        }
        
        audioElement = new Audio();
        audioElement.src = URL.createObjectURL(file);
        audioElement.controls = false;
        
        // Initialize Web Audio API
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        // Create analyser
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        
        // Create source from audio element
        audioSource = audioContext.createMediaElementSource(audioElement);
        
        // Create destination for recording
        const destination = audioContext.createMediaStreamDestination();
        
        // Connect: source -> analyser -> destination
        audioSource.connect(analyser);
        analyser.connect(destination);
        
        // Also connect to speakers for monitoring
        analyser.connect(audioContext.destination);
        
        // Store the audio stream
        mediaStream = destination.stream;
        
        statusEl.textContent = `Audio loaded: ${file.name}. Ready to record!`;
        recordBtn.disabled = false;
        
        // Draw initial frame
        drawInitialFrame();
        
    } catch (error) {
        statusEl.textContent = `Error loading audio: ${error.message}`;
        console.error(error);
    }
});

// Visualize audio on canvas
function visualize() {
    if (!analyser) return;
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    function draw() {
        animationId = requestAnimationFrame(draw);
        
        if (!isRecording) return;
        
        analyser.getByteFrequencyData(dataArray);
        
        // Clear canvas
        canvasContext.fillStyle = '#000';
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw frequency bars
        const barWidth = (canvas.width / bufferLength) * 2.5;
        let barHeight;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
            
            const green = Math.floor((dataArray[i] / 255) * 255);
            canvasContext.fillStyle = `rgb(0, ${green}, 0)`;
            
            canvasContext.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
        
        // Draw time indicator
        if (audioElement) {
            canvasContext.fillStyle = '#0f0';
            canvasContext.font = '16px Courier New';
            canvasContext.textAlign = 'left';
            const timeText = `${audioElement.currentTime.toFixed(1)}s / ${audioElement.duration.toFixed(1)}s`;
            canvasContext.fillText(timeText, 10, 30);
        }
    }
    
    draw();
}

// Get supported video codec (VP9/VP8 fallback)
function getSupportedCodec() {
    const codecs = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
    ];
    
    for (const codec of codecs) {
        if (MediaRecorder.isTypeSupported(codec)) {
            return codec;
        }
    }
    
    return 'video/webm';
}

// Start recording
recordBtn.addEventListener('click', async () => {
    try {
        recordedChunks = [];
        
        // Get canvas stream
        const canvasStream = canvas.captureStream(30); // 30 FPS
        
        // Combine canvas video and audio
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...mediaStream.getAudioTracks()
        ]);
        
        // Get supported codec
        const mimeType = getSupportedCodec();
        statusEl.textContent = `Using codec: ${mimeType}`;
        
        // Create MediaRecorder with timeslice
        mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000
        });
        
        // Handle data available (timesliced)
        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        // Handle stop
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: mimeType });
            const url = URL.createObjectURL(blob);
            downloadBtn.href = url;
            downloadBtn.download = `LST-recording-${Date.now()}.webm`;
            downloadBtn.style.display = 'inline-block';
            statusEl.textContent = 'Recording complete! Click download to save.';
            isRecording = false;
        };
        
        // Start recording with 100ms timeslice
        mediaRecorder.start(100);
        isRecording = true;
        
        // Auto-stop when audio ends
        audioElement.addEventListener('ended', () => {
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                mediaRecorder.stop();
                statusEl.textContent = 'Recording stopped (audio ended)';
            }
        }, { once: true });
        
        // Start audio playback
        await audioElement.play();
        
        // Start visualization
        visualize();
        
        statusEl.textContent = 'Recording... Audio playing.';
        recordBtn.disabled = true;
        stopBtn.disabled = false;
        
    } catch (error) {
        statusEl.textContent = `Error starting recording: ${error.message}`;
        console.error(error);
        isRecording = false;
    }
});

// Stop recording manually
stopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        if (audioElement) {
            audioElement.pause();
            audioElement.currentTime = 0;
        }
        if (animationId) {
            cancelAnimationFrame(animationId);
        }
        statusEl.textContent = 'Recording stopped manually';
        recordBtn.disabled = false;
        stopBtn.disabled = true;
    }
});

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    drawInitialFrame();
    statusEl.textContent = 'Ready. Upload an audio file to begin.';
});
