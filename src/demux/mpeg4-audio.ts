export enum MPEG4AudioObjectTypes {
    kNull = 0,
    kAACMain,
    kAAC_LC,   // LC-AAC
    kAAC_SSR,
    kAAC_LTP,
    kAAC_SBR,  // HE-AAC
    kAAC_Scalable,

    kLayer1 = 32,
    kLayer2,
    kLayer3,   // MP3
}

export enum MPEG4SamplingFrequencyIndex {
    k96000Hz = 0,
    k88200Hz,
    k64000Hz,
    k48000Hz,
    k44100Hz,
    k32000Hz,
    k24000Hz,
    k22050Hz,
    k16000Hz,
    k12000Hz,
    k11025Hz,
    k8000Hz,
    k7350Hz,
}

export const MPEG4SamplingFrequencies = [
    96000,
    88200,
    64000,
    48000,
    44100,
    32000,
    24000,
    22050,
    16000,
    12000,
    11025,
    8000,
    7350,
];
