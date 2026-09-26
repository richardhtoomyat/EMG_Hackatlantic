#pragma once

#include <stdint.h>
#include <stddef.h>

// Communication Configuration
static constexpr uint32_t SERIAL_BAUD_RATE    = 230400;
static constexpr uint32_t SAMPLE_RATE_HZ      = 1000;
static constexpr unsigned long SAMPLE_INTERVAL_US = 1000000 / SAMPLE_RATE_HZ;
static constexpr uint8_t SAMPLES_PER_BATCH    = 10;

// Base Station MAC: A4:F0:0F:8A:9B:E0
static const uint8_t BASE_STATION_MAC[6]      = {0xA4, 0xF0, 0x0F, 0x8A, 0x9B, 0xE0};
static constexpr uint8_t ESPNOW_WIFI_CHANNEL  = 0;

// Channel Architecture
static constexpr uint8_t NUM_CHANNELS         = 2;

// Signal Specifications (12-bit ADC)
static constexpr uint8_t  ADC_RESOLUTION_BITS = 12;
static constexpr uint16_t ADC_CENTER_VALUE    = 2048; // Centered default (V_IN / 2)
static constexpr uint16_t ADC_MAX_VALUE       = 4095;
static constexpr uint8_t  PACKET_TYPE_SAMPLE  = 0;
static constexpr uint8_t  PACKET_TYPE_SYNC    = 1;

// Each transmitter samples locally at 1 kHz and sends ten samples per packet.
// Sync packets use sampleCount == 0; sample packets use SAMPLES_PER_BATCH.
typedef struct __attribute__((packed)) {
    uint8_t  type;    // sample or synchronization beacon
    uint8_t  id;      // Channel ID (0 to NUM_CHANNELS - 1)
    uint16_t epoch;   // synchronization epoch
    uint16_t sequence;// batch index within epoch
    uint8_t sampleCount;
    uint16_t samples[SAMPLES_PER_BATCH]; // 12-bit ADC raw reads (0 - 4095)
} EmgPacket;
