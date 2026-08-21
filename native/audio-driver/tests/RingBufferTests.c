#include "../MeetingCopilotRingBuffer.h"

#include <assert.h>
#include <stddef.h>

int main(void)
{
    MCAudioRingBuffer buffer = { 0 };
    const float input[] = { 0.1f, -0.1f, 0.2f, -0.2f, 0.3f, -0.3f };
    float output[6] = { 0 };

    MCAudioRingBufferReset(&buffer);
    MCAudioRingBufferWrite(&buffer, MC_AUDIO_RING_BUFFER_FRAMES - 1, 3, input);
    MCAudioRingBufferRead(&buffer, MC_AUDIO_RING_BUFFER_FRAMES - 1, 3, output);
    for(size_t index = 0; index < 6; ++index) assert(output[index] == input[index]);

    float stale[2] = { 1.0f, 1.0f };
    MCAudioRingBufferRead(&buffer, 100000, 1, stale);
    assert(stale[0] == 0.0f && stale[1] == 0.0f);

    MCAudioRingBufferReset(&buffer);
    float reset[2] = { 1.0f, 1.0f };
    MCAudioRingBufferRead(&buffer, 0, 1, reset);
    assert(reset[0] == 0.0f && reset[1] == 0.0f);
    return 0;
}
