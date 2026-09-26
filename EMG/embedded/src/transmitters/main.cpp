#include <Arduino.h>
#include <esp_now.h>
#include <WiFi.h>
#include "emg_protocol.h"

// Ensure SENDER_ID is defined via build flag (e.g. -DSENDER_ID=0)
#ifndef SENDER_ID
#error "Compilation aborted: SENDER_ID is not defined!"
#endif

static EmgPacket packet;
static const int EMG_PIN = 39; // MyoWare Wireless Shield onboard ADC1 input
static unsigned long lastSampleMicros = 0;
static volatile uint16_t activeEpoch = 0;
static volatile uint16_t nextSequence = 0;
static volatile bool synchronized = false;

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 0, 0)
void onDataRecv(const esp_now_recv_info_t *recv_info, const uint8_t *incomingData, int len) {
#else
void onDataRecv(const uint8_t *mac, const uint8_t *incomingData, int len) {
#endif
    if (len != sizeof(EmgPacket)) return;
    const EmgPacket *incoming = reinterpret_cast<const EmgPacket*>(incomingData);
    if (incoming->type == PACKET_TYPE_SYNC) {
        activeEpoch = incoming->epoch;
        nextSequence = 0;
        lastSampleMicros = micros();
        synchronized = true;
    }
}

void setup() {
    Serial.begin(SERIAL_BAUD_RATE);

    // Configure ADC: 12-bit (0-4095) and 11dB attenuation (up to ~3.3V)
    analogReadResolution(ADC_RESOLUTION_BITS);
    analogSetAttenuation(ADC_11db);
    pinMode(EMG_PIN, INPUT);

    // Initialize Wi-Fi in Station mode (required by ESP-NOW)
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();

    // Initialize ESP-NOW protocol
    if (esp_now_init() != ESP_OK) {
        Serial.println("[ERROR] ESP-NOW initialization failed");
        return;
    }
    esp_now_register_recv_cb(onDataRecv);

    // Register Thing Plus Base Station as unicast peer
    esp_now_peer_info_t peerInfo = {};
    memcpy(peerInfo.peer_addr, BASE_STATION_MAC, 6);
    peerInfo.channel = ESPNOW_WIFI_CHANNEL;
    peerInfo.encrypt = false; // Disable encryption for minimal latency

    if (esp_now_add_peer(&peerInfo) != ESP_OK) {
        Serial.println("[ERROR] Failed to pair with Base Station");
        return;
    }

    // Set static channel identifier from compile flag
    packet.type = PACKET_TYPE_SAMPLE;
    packet.id = SENDER_ID;

    Serial.printf("[INIT] Transmitter ready. Assigned Channel ID: %d\n", packet.id);
}

void loop() {
    unsigned long currentMicros = micros();

    // Hardware sampling tick (1000 Hz)
    if (synchronized && currentMicros - lastSampleMicros >= SAMPLE_INTERVAL_US) {
        lastSampleMicros = currentMicros;

        // Sample EMG voltage
        packet.sample = static_cast<uint16_t>(analogRead(EMG_PIN));
        packet.epoch = activeEpoch;
        packet.sequence = nextSequence++;

        // Transmit the sample with its shared epoch and sequence number.
        esp_now_send(BASE_STATION_MAC, reinterpret_cast<uint8_t*>(&packet), sizeof(packet));
    }
}
