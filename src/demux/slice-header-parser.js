/*
 * Copyright (C) 2016 Bilibili. All Rights Reserved.
 *
 * @author East Zhou <zrdong@ulucu.com>
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

import Log from '../utils/logger.js';
import ExpGolomb from './exp-golomb.js';

export const FrameType = {
    FrameType_U: 0,     // unknown
    FrameType_I: 1,     // I frame
    FrameType_P: 2,     // P frame
    FrameType_B: 3      // B frame
};

export class SliceHeaderParser {
    static parseSliceHeader(uint8array, sps_info) {
        do {
            if (!sps_info) {
                Log.e('SliceHeaderParser', 'missing sps or pps!');
                break;
            }

            try {
                let gb = new ExpGolomb(uint8array);

                let nalu_header = gb.readByte();
                if (nalu_header & 0x80) // forbidden_zero_bit：在H.264规范中规定了这一位必须为0。
                    break;
    
                if (!(nalu_header & 0x60)) // 取00~11，似乎指示这个NALU的重要性, 如00的NALU解码器可以丢弃它而不影响图像的回放。
                    break;
    
                let unitType = nalu_header & 0x1F;
                gb.readUEG();   // first_mb_in_slice
                let slice_type = gb.readUEG();  // slice_type
                let slice_type_i  = (slice_type % 5 === 2);
                let slice_type_p  = (slice_type % 5 === 0);
                let slice_type_b  = (slice_type % 5 === 1);
                let slice_type_si = (slice_type % 5 === 4);
                let slice_type_sp = (slice_type % 5 === 3);
        
                let frame_type = FrameType.FrameType_I;
                if (slice_type_p || slice_type_sp) {
                    frame_type = FrameType.FrameType_P;
                } else if (slice_type_b) {
                    frame_type = FrameType.FrameType_B;
                }
        
                gb.readUEG();   // pic_parameter_set_id
        
                if (sps_info.separate_colour_plane_flag) {
                    gb.readBits(16);    // colour_plane_id
                }
        
                let frame_num = gb.readBits(sps_info.log2_max_frame_num_minus4 + 4);
        
                return {
                    success: true, 
                    data: {
                        frame_type: frame_type, 
                        frame_num: frame_num
                    }
                };
            } catch (error) {
                Log.e('SliceHeaderParser', error.message);
                break;
            }
        } while (0);

        return {
            success: false, 
            data: {
            }
        };
    }
}
