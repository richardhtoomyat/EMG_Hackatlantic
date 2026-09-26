#include <WiFi.h>

// used to get the MAC adress of the reciver satation:  A4:F0:0F:8A:9B:E0 
void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  Serial.print("Base Station MAC: ");
  Serial.println(WiFi.macAddress());
}
void loop() {
    Serial.print("Base Station MAC: ");
    Serial.println(WiFi.macAddress());
}