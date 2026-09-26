#include <Arduino.h>
#include <esp_now.h>
#include <WiFi.h>
#include "emg_protocol.h"

// Volatile channel registers written by the ESP-NOW interrupt context
static constexpr uint8_t FRAME_BUFFER_SIZE = 16;
struct Frame {
    uint16_t epoch = 0;
    uint16_t sequence = 0;
    uint16_t samples[NUM_CHANNELS] = {};
    uint8_t mask = 0;
    bool occupied = false;
};
static Frame frames[FRAME_BUFFER_SIZE];
static volatile uint16_t currentEpoch = 0;
static volatile uint8_t seenChannels = 0;
static volatile uint16_t highestReceivedSequence = 0;
static uint8_t activeChannels = 0;
static unsigned long epochStartedMillis = 0;
static bool activeMaskReady = false;
static uint16_t nextOutputSequence = 0;
static unsigned long lastSyncMillis = 0;
static uint16_t nextEpoch = 1;
static const uint8_t BROADCAST_MAC[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// High-speed ESP-NOW receive callback (runs in Wi-Fi task context)
#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *incomingData, int len) {
#else
void onDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
#endif
    if (len == sizeof(EmgPacket)) {
        const EmgPacket* pkt = reinterpret_cast<const EmgPacket*>(incomingData);
        if (pkt->type == PACKET_TYPE_SAMPLE && pkt->id < NUM_CHANNELS && pkt->sample <= ADC_MAX_VALUE) {
            uint16_t epoch = currentEpoch;
            if (pkt->epoch == epoch) {
                Frame &frame = frames[pkt->sequence % FRAME_BUFFER_SIZE];
                if (!frame.occupied || frame.epoch != pkt->epoch || frame.sequence != pkt->sequence) {
                    frame.epoch = pkt->epoch;
                    frame.sequence = pkt->sequence;
                    frame.mask = 0;
                    frame.occupied = true;
                }
                frame.samples[pkt->id] = pkt->sample;
                frame.mask |= static_cast<uint8_t>(1U << pkt->id);
                seenChannels |= static_cast<uint8_t>(1U << pkt->id);
                if (pkt->sequence > highestReceivedSequence) highestReceivedSequence = pkt->sequence;
            }
        }
    }
}

void setup() {
    // Match this in your Python relay script.
    Serial.begin(SERIAL_BAUD_RATE);

    // Initialize Station mode without connecting to any AP
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();

    // Verify MAC address matches expected target
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

    // Register incoming packet callback
    esp_now_register_recv_cb(onDataRecv);
    Serial.println("[INIT] ESP-NOW callback registered. Listening for transmitters...");
}

void loop() {
    // Periodic broadcast resets both transmitters onto a common sample epoch.
    unsigned long now = millis();
    if (now - lastSyncMillis >= 1000) {
        lastSyncMillis = now;
        EmgPacket sync = {};
        sync.type = PACKET_TYPE_SYNC;
        sync.epoch = nextEpoch++;
        currentEpoch = sync.epoch;
        seenChannels = 0;
        highestReceivedSequence = 0;
        activeChannels = 0;
        activeMaskReady = false;
        epochStartedMillis = now;
        nextOutputSequence = 0;
        for (auto &frame : frames) frame.occupied = false;
        esp_now_send(BROADCAST_MAC, reinterpret_cast<uint8_t*>(&sync), sizeof(sync));
    }

    // Detect configured sensors from the first 100 ms of each epoch. This
    // supports one sensor while retaining the two-column serial protocol.
    if (!activeMaskReady && now - epochStartedMillis >= 100) {
        activeChannels = seenChannels;
        if (activeChannels == 0) activeChannels = (1U << NUM_CHANNELS) - 1;
        uint16_t high = highestReceivedSequence;
        nextOutputSequence = high >= FRAME_BUFFER_SIZE ? high - FRAME_BUFFER_SIZE + 1 : 0;
        activeMaskReady = true;
    }

    // Serialize only matching sequence numbers from active sensors.
    Frame &frame = frames[nextOutputSequence % FRAME_BUFFER_SIZE];
    if (activeMaskReady && frame.occupied && frame.epoch == currentEpoch && frame.sequence == nextOutputSequence && (frame.mask & activeChannels) == activeChannels) {
        for (uint8_t i = 0; i < NUM_CHANNELS; i++) {
            if (activeChannels & (1U << i)) Serial.print(frame.samples[i]);
            else Serial.print(-1); // Missing/inactive channel; valid ADC values are 0..4095.
            if (i < NUM_CHANNELS - 1) Serial.print(',');
        }
        Serial.println();
        frame.occupied = false;
        nextOutputSequence++;
    } else if (activeMaskReady && nextOutputSequence > 0 && frame.occupied && frame.sequence > nextOutputSequence) {
        // Drop a frame whose packet was lost rather than blocking later data.
        nextOutputSequence++;
    }
}
