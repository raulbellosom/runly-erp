# Genera un audio SINTETICO en espanol (voz de Windows, System.Speech) para poder
# ejecutar la PoC de faster-whisper sin depender de una grabacion real de Runly.
#
# Esto NO sustituye la validacion pedida en la Etapa 1 del plan de implementacion
# (audio real de una reunion, 10-20 minutos, en el VPS de destino) — es un
# generador de humo (smoke test) para validar que el pipeline funciona de
# extremo a extremo y obtener una primera medicion real, aunque sea sobre
# contenido sintetico y en una maquina distinta al KVM 4.
#
# Uso: powershell -File generate_sample_audio.ps1 -OutPath sample-audio\sample_meeting_es.wav

param(
    [string]$OutPath = "sample-audio\sample_meeting_es.wav"
)

Add-Type -AssemblyName System.Speech

$dialogue = @(
    @{Voice = "Microsoft Sabina Desktop"; Text = "Buenos dias a todos, gracias por unirse a esta reunion de seguimiento del proyecto." },
    @{Voice = "Microsoft Helena Desktop"; Text = "Buenos dias Raul, aqui estamos. Empezamos revisando los pendientes del modulo de inventario." },
    @{Voice = "Microsoft Sabina Desktop"; Text = "Si, exactamente. Necesitamos revisar los pendientes del proyecto antes del viernes." },
    @{Voice = "Microsoft Helena Desktop"; Text = "Yo puedo encargarme de realizar las pruebas de esa parte esta semana." },
    @{Voice = "Microsoft Sabina Desktop"; Text = "Perfecto, entonces lo revisamos manana por la tarde para confirmar avances." },
    @{Voice = "Microsoft Helena Desktop"; Text = "De acuerdo. Tambien queria mencionar que el cliente pidio una demostracion la proxima semana." },
    @{Voice = "Microsoft Sabina Desktop"; Text = "Buena idea, vamos a proponer el proximo viernes a las diez de la manana para esa demostracion." },
    @{Voice = "Microsoft Helena Desktop"; Text = "Me parece bien, yo preparo la agenda y se las comparto por correo." },
    @{Voice = "Microsoft Sabina Desktop"; Text = "Excelente, entonces quedamos asi. Gracias a todos por su tiempo, nos vemos manana." }
)

$fullOutPath = Join-Path (Get-Location) $OutPath
$outDir = Split-Path $fullOutPath -Parent
if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(
    16000,
    [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
    [System.Speech.AudioFormat.AudioChannel]::Mono
)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SetOutputToWaveFile($fullOutPath, $format)
$synth.Rate = -1

foreach ($line in $dialogue) {
    $synth.SelectVoice($line.Voice)
    $synth.Speak($line.Text)
}

$synth.SetOutputToNull()
$synth.Dispose()

Write-Output "Audio sintetico generado en: $fullOutPath"
