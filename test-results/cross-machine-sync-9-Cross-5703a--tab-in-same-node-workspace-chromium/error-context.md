# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cross-machine-sync.spec.mjs >> 9. Cross-Machine Tab Sync >> 9.2 — VPS create terminal: local sees tab in same node workspace
- Location: tests\e2e\cross-machine-sync.spec.mjs:1043:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]:
          - button "Collapse sidebar (Ctrl+B)" [ref=e6] [cursor=pointer]:
            - img [ref=e7]
          - img [ref=e9]
          - button "SessionBridge" [ref=e12] [cursor=pointer]
          - generic [ref=e13]: "|"
          - generic [ref=e14]: CONNECTED
          - generic [ref=e16]: Idle
        - generic [ref=e17]:
          - button "Collapse right sidebar" [ref=e18] [cursor=pointer]:
            - img [ref=e19]
          - button "Dashboard" [ref=e21] [cursor=pointer]:
            - img [ref=e22]
          - generic [ref=e27]:
            - button "Dashboard" [ref=e28] [cursor=pointer]:
              - img [ref=e29]
              - text: Dashboard
            - button "Settings" [ref=e34] [cursor=pointer]:
              - img [ref=e35]
              - text: Settings
    - generic [ref=e38]:
      - generic [ref=e39] [cursor=pointer]:
        - button "PENGSPC LAN" [ref=e40]:
          - img [ref=e42]
          - generic [ref=e45]: PENGSPC
          - generic [ref=e46]: LAN
        - button "Hide this node" [ref=e47]:
          - img [ref=e48]
      - generic [ref=e51] [cursor=pointer]:
        - button "43.160.241.180 WAN RELAY" [ref=e52]:
          - img [ref=e54]
          - generic [ref=e57]: 43.160.241.180
          - generic [ref=e58]: WAN
          - generic [ref=e59]: RELAY
        - button "Hide this node" [ref=e60]:
          - img [ref=e61]
      - button "Connection manager" [ref=e64] [cursor=pointer]:
        - img [ref=e65]
    - generic [ref=e66]:
      - generic [ref=e67]:
        - complementary
      - main [ref=e68]:
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e74] [cursor=pointer]:
              - img [ref=e75]
              - generic [ref=e78]:
                - generic [ref=e79]: 43.160.241.180
                - generic [ref=e80]: 43.160.241.180:8080
              - generic [ref=e81]:
                - generic [ref=e82]: WAN
                - generic [ref=e83]: RELAY
                - generic [ref=e84]: Enter
            - generic [ref=e86]: connected upstream
            - generic [ref=e88] [cursor=pointer]:
              - img [ref=e89]
              - generic [ref=e92]:
                - generic [ref=e93]: PENGSPC
                - generic [ref=e94]: 172.17.48.1:14400
              - generic [ref=e95]:
                - generic [ref=e96]: LAN
                - generic [ref=e97]: Enter
          - generic [ref=e98]:
            - heading "连接管理● 1 active" [level=3] [ref=e99]:
              - text: 连接管理
              - generic [ref=e100]: ● 1 active
            - generic [ref=e102]:
              - generic [ref=e103]:
                - generic [ref=e104]:
                  - generic "ws://43.160.241.180:8080" [ref=e105]: 43.160.241.180
                  - generic "active" [ref=e106]
                - generic [ref=e107]:
                  - generic [ref=e108]: 主动连接
                  - generic [ref=e109]: upstream
                  - generic [ref=e110]: "--"
                  - generic [ref=e111]: connected
              - button "断开" [ref=e113] [cursor=pointer]
            - generic [ref=e114]:
              - textbox "ws://<ip>:8080" [ref=e115]
              - button "保存" [ref=e117] [cursor=pointer]
      - generic [ref=e118]:
        - complementary
    - generic [ref=e121]: "# Empty"
  - alert [ref=e122]
  - button "⌘, Settings" [ref=e123] [cursor=pointer]:
    - generic [ref=e124]: ⌘,
    - generic [ref=e125]: Settings
```

# Test source

```ts
  979  | 
  980  |   test('8.4 — Extensions exist in dist', async ({ browser }) => {
  981  |     // Check via API since we can't test file system from browser
  982  |     const p = await browser.newPage();
  983  |     const resp = await p.request.get(LOCAL_URL + '/api/status');
  984  |     expect(resp.ok()).toBeTruthy();
  985  |     const status = await resp.json();
  986  |     console.log('[8.4] API status — adapters:', status.adapters, '| version:', status.version);
  987  |     expect(status.version).toBeTruthy();
  988  |     await p.close();
  989  |   });
  990  | });
  991  | 
  992  | // ═══════════════════════════════════════════════════════════════
  993  | // SECTION 9: Cross-Machine Sync (9.1 - 9.6)
  994  | // ═══════════════════════════════════════════════════════════════
  995  | 
  996  | test.describe('9. Cross-Machine Tab Sync', () => {
  997  | 
  998  |   test('9.1 — Local create terminal: VPS sees tab in same node workspace', async ({ browser }) => {
  999  |     const local = await browser.newPage();
  1000 |     const vps   = await browser.newPage();
  1001 | 
  1002 |     await local.goto(LOCAL_URL, { waitUntil: 'networkidle' });
  1003 |     await vps.goto(VPS_URL, { waitUntil: 'networkidle' });
  1004 |     await wait(3000);
  1005 |     await waitForConnected(local);
  1006 |     await waitForConnected(vps);
  1007 | 
  1008 |     // Both enter the LOCAL node (PENGSPC) workspace so they view the same node
  1009 |     await enterWorkspace(local, 'PENGSPC');
  1010 |     // VPS also enters PENGSPC workspace (the local node, synced via upstream)
  1011 |     await enterWorkspace(vps, 'PENGSPC');
  1012 | 
  1013 |     // Check VPS tab titles before local creates terminal
  1014 |     const vpsTabsBefore = await getWorkbenchTabTitles(vps);
  1015 |     console.log('[9.1] VPS tabs before:', vpsTabsBefore);
  1016 | 
  1017 |     // Local creates a terminal on PENGSPC
  1018 |     await createTerminal(local);
  1019 |     await wait(5000); // Wait for surface sync across relays
  1020 | 
  1021 |     // VPS should see the new tab appear (surface sync local→VPS)
  1022 |     const vpsTabsAfter = await getWorkbenchTabTitles(vps);
  1023 |     console.log('[9.1] VPS tabs after:', vpsTabsAfter);
  1024 | 
  1025 |     // Verify at least one of: tab count increased OR a "Terminal" tab appeared
  1026 |     const vpsHasTerminal = vpsTabsAfter.some(t => t.toLowerCase().includes('term') || t === 'shell');
  1027 |     const vpsTabsAdded = vpsTabsAfter.length > vpsTabsBefore.length;
  1028 |     console.log('[9.1] VPS tabs added:', vpsTabsAdded, '| has terminal:', vpsHasTerminal);
  1029 | 
  1030 |     // Check local tab titles too
  1031 |     const localTabs = await getWorkbenchTabTitles(local);
  1032 |     console.log('[9.1] Local tabs:', localTabs);
  1033 |     expect(localTabs.length).toBeGreaterThan(0);
  1034 | 
  1035 |     // Cross-machine sync: VPS should see the terminal created on local
  1036 |     // Reports FAIL when sync is broken (real feedback)
  1037 |     expect(vpsTabsAdded || vpsHasTerminal).toBe(true);
  1038 | 
  1039 |     await local.close();
  1040 |     await vps.close();
  1041 |   });
  1042 | 
  1043 |   test('9.2 — VPS create terminal: local sees tab in same node workspace', async ({ browser }) => {
  1044 |     const local = await browser.newPage();
  1045 |     const vps   = await browser.newPage();
  1046 | 
  1047 |     await local.goto(LOCAL_URL, { waitUntil: 'networkidle' });
  1048 |     await vps.goto(VPS_URL, { waitUntil: 'networkidle' });
  1049 |     await wait(3000);
  1050 |     await waitForConnected(local);
  1051 |     await waitForConnected(vps);
  1052 | 
  1053 |     // Both enter the VPS node workspace so they view the same node
  1054 |     await enterWorkspace(vps, 'VM-0');
  1055 |     await enterWorkspace(local, 'VM-0');
  1056 | 
  1057 |     // Check local tabs before VPS creates terminal
  1058 |     const localTabsBefore = await getWorkbenchTabTitles(local);
  1059 |     console.log('[9.2] Local tabs before:', localTabsBefore);
  1060 | 
  1061 |     // VPS creates a terminal
  1062 |     await createTerminal(vps);
  1063 |     await wait(5000);
  1064 | 
  1065 |     // Local should see the new tab (surface sync VPS→local)
  1066 |     const localTabsAfter = await getWorkbenchTabTitles(local);
  1067 |     console.log('[9.2] Local tabs after:', localTabsAfter);
  1068 | 
  1069 |     const localTabsAdded = localTabsAfter.length > localTabsBefore.length;
  1070 |     const localHasTerminal = localTabsAfter.some(t => t.toLowerCase().includes('term') || t.includes('shell'));
  1071 |     console.log('[9.2] Local tabs added:', localTabsAdded, '| has terminal:', localHasTerminal);
  1072 | 
  1073 |     const vpsTabs = await getWorkbenchTabTitles(vps);
  1074 |     console.log('[9.2] VPS tabs:', vpsTabs);
  1075 |     expect(vpsTabs.length).toBeGreaterThan(0);
  1076 | 
  1077 |     // Cross-machine sync: local should see the terminal created on VPS
  1078 |     // Reports FAIL when sync is broken (real feedback)
> 1079 |     expect(localTabsAdded || localHasTerminal).toBe(true);
       |                                                ^ Error: expect(received).toBe(expected) // Object.is equality
  1080 | 
  1081 |     await local.close();
  1082 |     await vps.close();
  1083 |   });
  1084 | 
  1085 |   test('9.5 — Tab close removes from workbench', async ({ browser }) => {
  1086 |     const p = await browser.newPage();
  1087 |     await p.goto(LOCAL_URL, { waitUntil: 'networkidle' });
  1088 |     await wait(3000);
  1089 |     await waitForConnected(p);
  1090 | 
  1091 |     await createTerminal(p);
  1092 |     await wait(2000);
  1093 | 
  1094 |     const tabsBefore = await getWorkbenchTabTitles(p);
  1095 |     console.log('[9.5] Tabs before close:', tabsBefore);
  1096 |     expect(tabsBefore.length).toBeGreaterThanOrEqual(1);
  1097 | 
  1098 |     // Find and click the tab close X button — any small button in the tab bar
  1099 |     // that's NOT the "Add view" button
  1100 |     const closeResult = await p.evaluate(() => {
  1101 |       const bars = document.querySelectorAll('[class*="h-7"], [class*="tab-bar"], [class*="TabBar"]');
  1102 |       for (const bar of bars) {
  1103 |         const btns = bar.querySelectorAll('button');
  1104 |         for (const btn of btns) {
  1105 |           const title = btn.getAttribute('title') || '';
  1106 |           const rect = btn.getBoundingClientRect();
  1107 |           // Close buttons are small (under 30px) and not "Add view"
  1108 |           if (title !== 'Add view' && rect.width > 0 && rect.width < 30 && rect.height > 0) {
  1109 |             (btn).click();
  1110 |             return `clicked close btn: title="${title}" size=${rect.width}x${rect.height}`;
  1111 |           }
  1112 |         }
  1113 |       }
  1114 |       // Fallback: click any button with svg child in tab area
  1115 |       for (const bar of bars) {
  1116 |         const btns = bar.querySelectorAll('button');
  1117 |         for (const btn of btns) {
  1118 |           if (btn.querySelector('svg') && (btn.getAttribute('title') || '').includes('Add view') === false) {
  1119 |             (btn).click();
  1120 |             return `fallback clicked btn with svg: title="${btn.getAttribute('title')}"`;
  1121 |           }
  1122 |         }
  1123 |       }
  1124 |       return 'no close button found';
  1125 |     });
  1126 |     console.log('[9.5] Close result:', closeResult);
  1127 | 
  1128 |     await wait(1500);
  1129 |     const tabsAfter = await getWorkbenchTabTitles(p);
  1130 |     console.log('[9.5] Tabs after close:', tabsAfter);
  1131 |     // Tab should have been removed
  1132 |     const removed = tabsAfter.length < tabsBefore.length;
  1133 |     console.log('[9.5] Tab removed:', removed);
  1134 |     if (tabsBefore.length > 1) {
  1135 |       expect(tabsAfter.length).toBeLessThan(tabsBefore.length);
  1136 |     }
  1137 |     await p.close();
  1138 |   });
  1139 | });
  1140 | 
  1141 | // ═══════════════════════════════════════════════════════════════
  1142 | // SECTION A: API-Level Verification (fast, no browser needed)
  1143 | // ═══════════════════════════════════════════════════════════════
  1144 | 
  1145 | test.describe('A. API Verification', () => {
  1146 | 
  1147 |   test('A.1 — Local relay health check', async ({ request }) => {
  1148 |     const resp = await request.get(LOCAL_URL + '/api/health');
  1149 |     expect(resp.ok()).toBeTruthy();
  1150 |     const body = await resp.json();
  1151 |     console.log('[A.1] Local health — uptime:', body.uptime, '| instances:', body.instanceCount);
  1152 |     expect(body.status).toBe('ok');
  1153 |   });
  1154 | 
  1155 |   test('A.2 — VPS relay health check', async ({ request }) => {
  1156 |     const resp = await request.get(VPS_URL + '/api/health');
  1157 |     expect(resp.ok()).toBeTruthy();
  1158 |     const body = await resp.json();
  1159 |     console.log('[A.2] VPS health — uptime:', body.uptime, '| instances:', body.instanceCount);
  1160 |     expect(body.status).toBe('ok');
  1161 |   });
  1162 | 
  1163 |   test('A.3 — Local status shows version and platform', async ({ request }) => {
  1164 |     const resp = await request.get(LOCAL_URL + '/api/status');
  1165 |     expect(resp.ok()).toBeTruthy();
  1166 |     const body = await resp.json();
  1167 |     console.log('[A.3] Local — version:', body.version, '| platform:', body.system?.platform, '| hostname:', body.system?.hostname);
  1168 |     expect(body.version).toBe('0.6.0');
  1169 |     expect(body.system.platform).toBe('win32');
  1170 |   });
  1171 | 
  1172 |   test('A.4 — VPS status shows version and platform', async ({ request }) => {
  1173 |     const resp = await request.get(VPS_URL + '/api/status');
  1174 |     expect(resp.ok()).toBeTruthy();
  1175 |     const body = await resp.json();
  1176 |     console.log('[A.4] VPS — version:', body.version, '| platform:', body.system?.platform, '| hostname:', body.system?.hostname);
  1177 |     expect(body.version).toBe('0.6.0');
  1178 |     expect(body.system.platform).toBe('linux');
  1179 |   });
```