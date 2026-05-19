# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: cross-machine-sync.spec.mjs >> 9. Cross-Machine Tab Sync >> 9.1 — Local create terminal: VPS sees tab in same node workspace
- Location: tests\e2e\cross-machine-sync.spec.mjs:998:3

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
      - button "PENGSPC LAN" [ref=e40] [cursor=pointer]:
        - img [ref=e42]
        - generic [ref=e45]: PENGSPC
        - generic [ref=e46]: LAN
      - generic [ref=e47] [cursor=pointer]:
        - button "43.160.241.180 WAN RELAY" [ref=e48]:
          - img [ref=e50]
          - generic [ref=e53]: 43.160.241.180
          - generic [ref=e54]: WAN
          - generic [ref=e55]: RELAY
        - button "Hide this node" [ref=e56]:
          - img [ref=e57]
      - button "Refresh tabs" [ref=e60] [cursor=pointer]:
        - img [ref=e61]
      - button "Connection manager" [ref=e66] [cursor=pointer]:
        - img [ref=e67]
    - generic [ref=e68]:
      - generic [ref=e69]:
        - complementary
      - main [ref=e70]:
        - generic [ref=e71]:
          - generic [ref=e72]:
            - generic [ref=e73]: WORKBENCH
            - generic [ref=e75]: msg:0
          - generic [ref=e78]:
            - generic [ref=e80]:
              - generic [ref=e81] [cursor=pointer]:
                - generic [ref=e82]: T
                - generic [ref=e83]: Terminal
                - button [ref=e84]:
                  - img [ref=e85]
              - generic [ref=e88] [cursor=pointer]:
                - generic [ref=e89]: +
                - generic [ref=e90]: New
                - button [ref=e91]:
                  - img [ref=e92]
              - button "Add view" [ref=e95] [cursor=pointer]:
                - img [ref=e96]
            - generic [ref=e99]:
              - button [ref=e100] [cursor=pointer]:
                - img [ref=e101]
              - generic [ref=e102]: Select a view to open
      - generic [ref=e103]:
        - complementary
    - generic [ref=e106]: "# Empty"
  - alert [ref=e107]
  - button "⌘, Settings" [ref=e108] [cursor=pointer]:
    - generic [ref=e109]: ⌘,
    - generic [ref=e110]: Settings
```

# Test source

```ts
  937  |     await waitForConnected(p);
  938  | 
  939  |     // Get full page text
  940  |     const body = await p.evaluate(() => document.body.textContent?.substring(0, 2000) || '');
  941  |     console.log('[8.1] Body excerpt:', body.substring(0, 250));
  942  |     // Should contain connection info, node names, or UI elements
  943  |     const hasUI = body.includes('PENGSPC') || body.includes('CONNECTED') || body.includes('Remote Console');
  944  |     console.log('[8.1] Has recognizable UI:', hasUI);
  945  |     expect(body.length).toBeGreaterThan(50);
  946  |     await p.close();
  947  |   });
  948  | 
  949  |   test('8.2 — Right panel "Bookmarks" visible', async ({ browser }) => {
  950  |     const p = await browser.newPage();
  951  |     await p.goto(LOCAL_URL, { waitUntil: 'networkidle' });
  952  |     await wait(2000);
  953  |     await waitForConnected(p);
  954  | 
  955  |     const right = await getRightSidebarText(p);
  956  |     console.log('[8.2] Right sidebar:', right.substring(0, 200));
  957  |     const hasBookmarks = right.includes('Bookmarks') || right.includes('RESTORE');
  958  |     console.log('[8.2] Has bookmarks panel:', hasBookmarks);
  959  |     expect(right.length).toBeGreaterThan(0);
  960  |     await p.close();
  961  |   });
  962  | 
  963  |   test('8.3 — Settings shows extension configuration sections', async ({ browser }) => {
  964  |     const p = await browser.newPage();
  965  |     await p.goto(LOCAL_URL, { waitUntil: 'networkidle' });
  966  |     await wait(2000);
  967  |     await waitForConnected(p);
  968  | 
  969  |     await openSettings(p);
  970  |     await wait(500);
  971  | 
  972  |     // Get all settings text
  973  |     const settingsText = await p.evaluate(() => document.body.textContent?.substring(0, 1000) || '');
  974  |     console.log('[8.3] Settings text:', settingsText.substring(0, 300));
  975  |     // Should have config-related content
  976  |     expect(settingsText.length).toBeGreaterThan(50);
  977  |     await p.close();
  978  |   });
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
> 1037 |     expect(vpsTabsAdded || vpsHasTerminal).toBe(true);
       |                                            ^ Error: expect(received).toBe(expected) // Object.is equality
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
  1079 |     expect(localTabsAdded || localHasTerminal).toBe(true);
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
```