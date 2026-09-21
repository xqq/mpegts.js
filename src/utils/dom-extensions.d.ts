/*
 * Copyright (C) 2026 magicxqq. All Rights Reserved.
 *
 * @author magicxqq <xqq@xqq.im>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Ambient declarations for non-standard DOM members the player probes at runtime.
// This file has no top-level import/export on purpose: that keeps it a global script,
// so the interfaces below merge with the ones from lib.dom.d.ts.

interface HTMLVideoElement {
    // Legacy WebKit frame counters, used as a fallback where
    // HTMLVideoElement.getVideoPlaybackQuality() is unavailable. Absent on
    // browsers that never shipped them, hence optional.
    readonly webkitDecodedFrameCount?: number;
    readonly webkitDroppedFrameCount?: number;
}
