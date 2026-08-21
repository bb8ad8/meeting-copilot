#include "MeetingCopilotRingBuffer.h"

#include <string.h>

_Static_assert(ATOMIC_INT_LOCK_FREE == 2, "The audio ring buffer requires lock-free 32-bit atomics");

static uint32_t floatBits(float value)
{
    uint32_t bits;
    memcpy(&bits, &value, sizeof(bits));
    return bits;
}

static float bitsFloat(uint32_t bits)
{
    float value;
    memcpy(&value, &bits, sizeof(value));
    return value;
}

void MCAudioRingBufferReset(MCAudioRingBuffer* buffer)
{
    for(uint32_t index = 0; index < MC_AUDIO_RING_BUFFER_FRAMES * MC_AUDIO_CHANNEL_COUNT; ++index)
    {
        atomic_store_explicit(&buffer->samples[index], 0, memory_order_relaxed);
    }
    atomic_store_explicit(&buffer->lastWrittenFrame, 0, memory_order_release);
}

void MCAudioRingBufferWrite(
    MCAudioRingBuffer* buffer,
    uint64_t startFrame,
    uint32_t frameCount,
    const float* samples
)
{
    for(uint32_t frame = 0; frame < frameCount; ++frame)
    {
        const uint64_t ringFrame = (startFrame + frame) % MC_AUDIO_RING_BUFFER_FRAMES;
        atomic_store_explicit(
            &buffer->samples[(ringFrame * MC_AUDIO_CHANNEL_COUNT)],
            floatBits(samples[(frame * MC_AUDIO_CHANNEL_COUNT)]),
            memory_order_relaxed
        );
        atomic_store_explicit(
            &buffer->samples[(ringFrame * MC_AUDIO_CHANNEL_COUNT) + 1],
            floatBits(samples[(frame * MC_AUDIO_CHANNEL_COUNT) + 1]),
            memory_order_relaxed
        );
    }
    atomic_store_explicit(
        &buffer->lastWrittenFrame,
        startFrame + frameCount,
        memory_order_release
    );
}

void MCAudioRingBufferRead(
    const MCAudioRingBuffer* buffer,
    uint64_t startFrame,
    uint32_t frameCount,
    float* samples
)
{
    const uint64_t lastWrittenFrame = atomic_load_explicit(
        &buffer->lastWrittenFrame,
        memory_order_acquire
    );
    for(uint32_t frame = 0; frame < frameCount; ++frame)
    {
        const uint64_t absoluteFrame = startFrame + frame;
        const bool hasFrame =
            absoluteFrame < lastWrittenFrame &&
            lastWrittenFrame - absoluteFrame <= MC_AUDIO_RING_BUFFER_FRAMES;
        if(hasFrame)
        {
            const uint64_t ringFrame = absoluteFrame % MC_AUDIO_RING_BUFFER_FRAMES;
            samples[(frame * MC_AUDIO_CHANNEL_COUNT)] = bitsFloat(atomic_load_explicit(
                &buffer->samples[(ringFrame * MC_AUDIO_CHANNEL_COUNT)],
                memory_order_relaxed
            ));
            samples[(frame * MC_AUDIO_CHANNEL_COUNT) + 1] = bitsFloat(atomic_load_explicit(
                &buffer->samples[(ringFrame * MC_AUDIO_CHANNEL_COUNT) + 1],
                memory_order_relaxed
            ));
        }
        else
        {
            samples[(frame * MC_AUDIO_CHANNEL_COUNT)] = 0;
            samples[(frame * MC_AUDIO_CHANNEL_COUNT) + 1] = 0;
        }
    }
}
