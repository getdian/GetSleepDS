"""
生成 H5 演示用的本地环境音（10 秒褐噪声 loop）。
用途：当 COS 因防盗链拒绝带 Referer 的请求时，演示页回退到这段音频，
不影响真实小程序（真实小程序仍应播放 COS 音频）。
"""

import os
import wave

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "server", "public", "site", "demo-ambient.wav")

SAMPLE_RATE = 22050
SECONDS = 10
FADE = 0.6


def main():
    rng = np.random.default_rng(20261018)
    count = SAMPLE_RATE * SECONDS
    white = rng.normal(0, 1, count)

    # 一阶低通，得到更柔和的褐噪声
    brown = np.zeros(count)
    acc = 0.0
    for i in range(count):
        acc = acc * 0.985 + white[i] * 0.15
        brown[i] = acc

    brown = brown / (np.max(np.abs(brown)) + 1e-9)
    # 少量低频正弦垫底，听起来更像“环境”而不是电流声
    t = np.arange(count) / SAMPLE_RATE
    pad = 0.12 * np.sin(2 * np.pi * 110 * t) + 0.08 * np.sin(2 * np.pi * 165 * t)
    signal = brown * 0.75 + pad

    fade_samples = int(SAMPLE_RATE * FADE)
    ramp = np.linspace(0, 1, fade_samples)
    signal[:fade_samples] *= ramp
    signal[-fade_samples:] *= ramp[::-1]

    signal = np.clip(signal, -1, 1)
    pcm = (signal * 32767).astype("<i2")

    with wave.open(OUT, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())

    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
