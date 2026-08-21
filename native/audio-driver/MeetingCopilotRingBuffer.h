#ifndef MEETING_COPILOT_RING_BUFFER_H
#define MEETING_COPILOT_RING_BUFFER_H

#include <stdatomic.h>
#include <stdbool.h>
#include <stdint.h>

#define MC_AUDIO_CHANNEL_COUNT 2
#define MC_AUDIO_RING_BUFFER_FRAMES 16384

typedef struct {
    _Atomic uint32_t samples[MC_AUDIO_RING_BUFFER_FRAMES * MC_AUDIO_CHANNEL_COUNT];
    _Atomic uint64_t lastWrittenFrame;
} MCAudioRingBuffer;

void MCAudioRingBufferReset(MCAudioRingBuffer* buffer);
void MCAudioRingBufferWrite(
    MCAudioRingBuffer* buffer,
    uint64_t startFrame,
    uint32_t frameCount,
    const float* samples
);
void MCAudioRingBufferRead(
    const MCAudioRingBuffer* buffer,
    uint64_t startFrame,
    uint32_t frameCount,
    float* samples
);

#endif
