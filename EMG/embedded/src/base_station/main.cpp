#include <Arduino.h>
#include <esp_now.h>
#include <WiFi.h>
#include "emg_protocol.h"

// Keep enough batches to absorb brief radio scheduling delays.
static constexpr uint8_t FRAME_BUFFER_SIZE = 32;
static constexpr uint32_t CHANNEL_TIMEOUT_MS = 1500;
static constexpr uint32_t FRAME_WAIT_US = 15000;

struct Frame {
    uint16_t epoch = 0;
    uint16_t sequence = 0;
    uint16_t samples[NUM_CHANNELS][SAMPLES_PER_BATCH] = {};
    uint32_t firstReceivedMicros = 0;
    uint8_t mask = 0;
    bool occupied = false;
};

static Frame frames[FRAME_BUFFER_SIZE];
static volatile uint16_t currentEpoch = 0;
static volatile uint32_t lastSeenMillis[NUM_CHANNELS] = {};
static uint16_t nextOutputSequence = 0;
static unsigned long lastSyncMillis = 0;
static uint16_t nextEpoch = 1;
static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *incomingData, int len) {
#else
void onDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
#endif
    if (len != sizeof(EmgPacket)) return;
    const EmgPacket *pkt = reinterpret_cast<const EmgPacket *>(incomingData);

    if (pkt->type != PACKET_TYPE_SAMPLE || pkt->id >= NUM_CHANNELS ||
        pkt->sampleCount != SAMPLES_PER_BATCH) return;
    for (uint8_t i = 0; i < SAMPLES_PER_BATCH; ++i) {
        if (pkt->samples[i] > ADC_MAX_VALUE) return;
    }

    const uint16_t epoch = currentEpoch;
    if (pkt->epoch != epoch) return;

    const uint32_t nowMillis = millis();
    lastSeenMillis[pkt->id] = nowMillis;

    Frame &frame = frames[pkt->sequence % FRAME_BUFFER_SIZE];
    if (!frame.occupied || frame.epoch != pkt->epoch || frame.sequence != pkt->sequence) {
        frame.epoch = pkt->epoch;
        frame.sequence = pkt->sequence;
        frame.mask = 0;
        frame.firstReceivedMicros = micros();
        frame.occupied = true;
    }
    for (uint8_t i = 0; i < SAMPLES_PER_BATCH; ++i) {
        frame.samples[pkt->id][i] = pkt->samples[i];
    }
    frame.mask |= static_cast<uint8_t>(1U << pkt->id);
}

void setup() {
    Serial.begin(SERIAL_BAUD_RATE);
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();

    Serial.printf("[INIT] Thing Plus Base Station Online. MAC: %s\n", WiFi.macAddress().c_str());
    if (esp_now_init() != ESP_OK) {
        Serial.println("[ERROR] ESP-NOW initialization failed");
        return;
    }

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, BROADCAST_MAC, 6);
    peer.channel = ESPNOW_WIFI_CHANNEL;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) != ESP_OK) {
        Serial.println("[ERROR] Failed to add broadcast peer");
        return;
    }

    esp_now_register_recv_cb(onDataRecv);
    Serial.println("[INIT] ESP-NOW callback registered. Listening for transmitters...");
}

void loop() {
    const unsigned long nowMillis = millis();
    const uint32_t nowMicros = micros();

    // Periodic sync recovers a transmitter that missed a previous beacon.
    if (nowMillis - lastSyncMillis >= 1000) {
        lastSyncMillis = nowMillis;
        EmgPacket sync = {};
        sync.type = PACKET_TYPE_SYNC;
        sync.epoch = nextEpoch++;
        currentEpoch = sync.epoch;
        nextOutputSequence = 0;
        for (auto &frame : frames) frame.occupied = false;
        esp_now_send(BROADCAST_MAC, reinterpret_cast<uint8_t *>(&sync), sizeof(sync));
    }

    // Channel presence is recalculated continuously from recent packets.
    // A late transmitter can become active immediately; a lost sync does not
    // lock it out for the rest of a fixed discovery window.
    uint8_t activeChannels = 0;
    for (uint8_t channel = 0; channel < NUM_CHANNELS; ++channel) {
        const uint32_t seenAt = lastSeenMillis[channel];
        if (seenAt != 0 && nowMillis - seenAt <= CHANNEL_TIMEOUT_MS) {
            activeChannels |= static_cast<uint8_t>(1U << channel);
        }
    }

    Frame &frame = frames[nextOutputSequence % FRAME_BUFFER_SIZE];
    if (frame.occupied && frame.epoch == currentEpoch && frame.sequence == nextOutputSequence) {
        const bool complete = (frame.mask & activeChannels) == activeChannels;
        const bool timedOut = nowMicros - frame.firstReceivedMicros >= FRAME_WAIT_US;
        if (complete || timedOut) {
            for (uint8_t sampleIndex = 0; sampleIndex < SAMPLES_PER_BATCH; ++sampleIndex) {
                for (uint8_t channel = 0; channel < NUM_CHANNELS; ++channel) {
                    const bool available = (activeChannels & (1U << channel)) &&
                                           (frame.mask & (1U << channel));
                    if (available) Serial.print(frame.samples[channel][sampleIndex]);
                    else Serial.print(-1);
                    if (channel < NUM_CHANNELS - 1) Serial.print(',');
                }
                Serial.println();
            }
            frame.occupied = false;
            ++nextOutputSequence;
        }
        return;
    }

    // If a whole batch was lost, skip it after a later batch has waited long
    // enough for its partner packet to arrive. This bounds stream latency.
    for (const auto &later : frames) {
        if (later.occupied && later.epoch == currentEpoch &&
            later.sequence > nextOutputSequence &&
            nowMicros - later.firstReceivedMicros >= FRAME_WAIT_US) {
            ++nextOutputSequence;
            break;
        }
    }
}
