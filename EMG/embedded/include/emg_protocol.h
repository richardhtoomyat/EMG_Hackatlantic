#pragma once

#include <stdint.h>
#include <stddef.h>

// Communication Configuration
static constexpr uint32_t SERIAL_BAUD_RATE    = 115200;
static constexpr uint32_t SAMPLE_RATE_HZ      = 1000;
static constexpr unsigned long SAMPLE_INTERVAL_US = 1000000 / SAMPLE_RATE_HZ;

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

// Shared Wire Protocol (Must match exact memory layout between TX and RX)
typedef struct __attribute__((packed)) {
    uint8_t  type;    // sample or synchronization beacon
    uint8_t  id;      // Channel ID (0 to NUM_CHANNELS - 1)
    uint16_t epoch;   // synchronization epoch
    uint16_t sequence;// sample index within epoch
    uint16_t sample;  // 12-bit ADC raw read (0 - 4095)
} EmgPacket;
