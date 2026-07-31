export const anatomyOptions = ["Primary Only", "Secondary", "Match Adjacent"] as const
export const smileLibraryOptions = ["Posterior", "Anterior"] as const
export const ponticTypeOptions = ["Ovate", "Modified Ovate", "Modified Ridge Lap", "Other"] as const
export const ponticDistanceOptions = ["Flush", "Off", "Into"] as const
export const yesNoOptions = ["Yes", "No"] as const

export const posteriorCutbackOptions = [
  "Buccal Surface Only",
  "Buccal, Mesial & Distal (to facial contacts)",
  "Buccal, Mesial & Distal Contacts & Occlusal (to central groove)",
] as const

export const anteriorCutbackOptions = [
  "Simple Facial",
  "With Mamelons",
  "Lab Preference",
] as const

export const collarTypeOptions = [
  "No Collar",
  "Lingual Collar",
  "360 Collar",
] as const

export const preferredSoftwareOptions = [
  "3 Shape",
  "Exocad",
] as const

export const distanceToAntagonistOptions = [
  "1.0–1.5 mm",
  "1.5–2.0 mm",
  "2.0–2.5 mm",
  "Lab Preference",
] as const

export const taperAngleOptions = [
  "0°",
  "3°",
  "6°",
  "Lab Preference",
] as const

export const emergenceProfileOptions = [
  "Concave",
  "Straight",
  "Convex",
  "Lab Preference",
] as const

export const screwRetainedCrownOptions = [
  "2.0 mm",
  "2.5 mm",
  "3.0 mm",
  "Lab Preference",
] as const

export type AnatomyOption = (typeof anatomyOptions)[number]
export type SmileLibraryOption = (typeof smileLibraryOptions)[number]
export type PonticTypeOption = (typeof ponticTypeOptions)[number]
export type PonticDistanceOption = (typeof ponticDistanceOptions)[number]
export type YesNoOption = (typeof yesNoOptions)[number]
export type PosteriorCutbackOption = (typeof posteriorCutbackOptions)[number]
export type AnteriorCutbackOption = (typeof anteriorCutbackOptions)[number]
export type CollarTypeOption = (typeof collarTypeOptions)[number]
export type PreferredSoftwareOption = (typeof preferredSoftwareOptions)[number]
export type DistanceToAntagonistOption = (typeof distanceToAntagonistOptions)[number]
export type TaperAngleOption = (typeof taperAngleOptions)[number]
export type EmergenceProfileOption = (typeof emergenceProfileOptions)[number]
export type ScrewRetainedCrownOption = (typeof screwRetainedCrownOptions)[number]

export type PreferenceFormPayload = {
  formType?: "full_contour" | "facial_cutback_coping"
  occlusion: {
    defaultValues: string
    comments: string
  }
  proximalContacts: {
    defaultValues: string
    comments: string
  }
  distalMostCrownContact: {
    defaultValues: string
    comments: string
  }
  anatomy: {
    option: AnatomyOption | ""
    comments: string
  }
  smileLibrary: {
    option: SmileLibraryOption | ""
    libraryName: string
    comments: string
    libraryFile?: {
      fileUrl: string
      fileName: string
    } | null
  }
  ponticType: {
    option: PonticTypeOption | ""
    comments: string
  }
  ponticDistanceFromTissue: {
    option: PonticDistanceOption | ""
    comments: string
    distanceMm: string
  }
  matchMarginalRidge: {
    option: YesNoOption | ""
    comments: string
  }
  posteriorCutback?: {
    option: PosteriorCutbackOption | ""
    comments: string
  }
  anteriorCutback?: {
    option: AnteriorCutbackOption | ""
    comments: string
  }
  copingPonticDistanceFromTissue?: {
    option: PonticDistanceOption | ""
    distanceMm: string
    comments: string
  }
  copingCollarType?: {
    option: CollarTypeOption | ""
    comments: string
  }
  copingCreateIsland?: {
    option: YesNoOption | ""
    comments: string
  }
  gingivaLevels?: {
    anteriorBuccal: string
    anteriorLingual: string
    anteriorMesialDistal: string
    posteriorBuccal: string
    posteriorLingual: string
    posteriorMesialDistal: string
    comments: string
  }
  distanceToAntagonist?: {
    option: DistanceToAntagonistOption | ""
    comments: string
  }
  identificationDots?: {
    option: YesNoOption | ""
    comments: string
  }
  internalRetentionGroove?: {
    option: YesNoOption | ""
    comments: string
  }
  taperAngle?: {
    option: TaperAngleOption | ""
    comments: string
  }
  emergenceProfile?: {
    option: EmergenceProfileOption | ""
    comments: string
  }
  screwRetainedCrown?: {
    option: ScrewRetainedCrownOption | ""
    comments: string
  }
  preferredSoftware?: {
    option: PreferredSoftwareOption | ""
  }
  uploadedImage1?: {
    fileUrl: string
    fileName: string
  } | null
  uploadedImage2?: {
    fileUrl: string
    fileName: string
  } | null
}

export type PreferenceFormRecord = {
  id: string
  clientId: string
  formName: string
  payload: PreferenceFormPayload
  createdAt: string
  updatedAt: string
}

export const createPreferenceFormDefaults = (): PreferenceFormPayload => ({
  formType: "full_contour",
  occlusion: {
    defaultValues: "0.4",
    comments: "",
  },
  proximalContacts: {
    defaultValues: "0.02",
    comments: "",
  },
  distalMostCrownContact: {
    defaultValues: "",
    comments: "",
  },
  anatomy: {
    option: "Match Adjacent",
    comments: "",
  },
  smileLibrary: {
    option: "",
    libraryName: "",
    comments: "",
    libraryFile: null,
  },
  ponticType: {
    option: "Modified Ridge Lap",
    comments: "",
  },
  ponticDistanceFromTissue: {
    option: "Into",
    comments: "",
    distanceMm: "0.15",
  },
  matchMarginalRidge: {
    option: "Yes",
    comments: "",
  },
  posteriorCutback: {
    option: "Buccal Surface Only",
    comments: "",
  },
  anteriorCutback: {
    option: "With Mamelons",
    comments: "",
  },
  copingPonticDistanceFromTissue: {
    option: "",
    distanceMm: "",
    comments: "",
  },
  copingCollarType: {
    option: "",
    comments: "",
  },
  copingCreateIsland: {
    option: "",
    comments: "",
  },
  gingivaLevels: {
    anteriorBuccal: "1.0",
    anteriorLingual: "0.5",
    anteriorMesialDistal: "0.5",
    posteriorBuccal: "1.0",
    posteriorLingual: "0.5",
    posteriorMesialDistal: "0.5",
    comments: "",
  },
  distanceToAntagonist: {
    option: "2.0–2.5 mm",
    comments: "",
  },
  identificationDots: {
    option: "",
    comments: "",
  },
  internalRetentionGroove: {
    option: "",
    comments: "",
  },
  taperAngle: {
    option: "3°",
    comments: "",
  },
  emergenceProfile: {
    option: "Concave",
    comments: "",
  },
  screwRetainedCrown: {
    option: "2.5 mm",
    comments: "",
  },
  preferredSoftware: {
    option: "",
  },
  uploadedImage1: null,
  uploadedImage2: null,
})

export function clonePreferenceFormPayload(payload?: Partial<PreferenceFormPayload> | null): PreferenceFormPayload {
  const defaults = createPreferenceFormDefaults()

  if (!payload) return defaults

  return {
    formType: payload.formType ?? "full_contour",
    occlusion: {
      defaultValues: payload.occlusion?.defaultValues ?? "",
      comments: payload.occlusion?.comments ?? "",
    },
    proximalContacts: {
      defaultValues: payload.proximalContacts?.defaultValues ?? "",
      comments: payload.proximalContacts?.comments ?? "",
    },
    distalMostCrownContact: {
      defaultValues: payload.distalMostCrownContact?.defaultValues ?? "",
      comments: payload.distalMostCrownContact?.comments ?? "",
    },
    anatomy: {
      option: payload.anatomy?.option ?? "",
      comments: payload.anatomy?.comments ?? "",
    },
    smileLibrary: {
      option: payload.smileLibrary?.option ?? "",
      libraryName: payload.smileLibrary?.libraryName ?? "",
      comments: payload.smileLibrary?.comments ?? "",
      libraryFile: payload.smileLibrary?.libraryFile ? {
        fileUrl: payload.smileLibrary.libraryFile.fileUrl ?? "",
        fileName: payload.smileLibrary.libraryFile.fileName ?? "",
      } : null,
    },
    ponticType: {
      option: payload.ponticType?.option ?? "",
      comments: payload.ponticType?.comments ?? "",
    },
    ponticDistanceFromTissue: {
      option: payload.ponticDistanceFromTissue?.option ?? "",
      comments: payload.ponticDistanceFromTissue?.comments ?? "",
      distanceMm: payload.ponticDistanceFromTissue?.distanceMm ?? "",
    },
    matchMarginalRidge: {
      option: payload.matchMarginalRidge?.option ?? "",
      comments: payload.matchMarginalRidge?.comments ?? "",
    },
    posteriorCutback: {
      option: payload.posteriorCutback?.option ?? "",
      comments: payload.posteriorCutback?.comments ?? "",
    },
    anteriorCutback: {
      option: payload.anteriorCutback?.option ?? "",
      comments: payload.anteriorCutback?.comments ?? "",
    },
    copingPonticDistanceFromTissue: {
      option: payload.copingPonticDistanceFromTissue?.option ?? "",
      distanceMm: payload.copingPonticDistanceFromTissue?.distanceMm ?? "",
      comments: payload.copingPonticDistanceFromTissue?.comments ?? "",
    },
    copingCollarType: {
      option: payload.copingCollarType?.option ?? "",
      comments: payload.copingCollarType?.comments ?? "",
    },
    copingCreateIsland: {
      option: payload.copingCreateIsland?.option ?? "",
      comments: payload.copingCreateIsland?.comments ?? "",
    },
    gingivaLevels: {
      anteriorBuccal: payload.gingivaLevels?.anteriorBuccal ?? defaults.gingivaLevels!.anteriorBuccal,
      anteriorLingual: payload.gingivaLevels?.anteriorLingual ?? defaults.gingivaLevels!.anteriorLingual,
      anteriorMesialDistal: payload.gingivaLevels?.anteriorMesialDistal ?? defaults.gingivaLevels!.anteriorMesialDistal,
      posteriorBuccal: payload.gingivaLevels?.posteriorBuccal ?? defaults.gingivaLevels!.posteriorBuccal,
      posteriorLingual: payload.gingivaLevels?.posteriorLingual ?? defaults.gingivaLevels!.posteriorLingual,
      posteriorMesialDistal: payload.gingivaLevels?.posteriorMesialDistal ?? defaults.gingivaLevels!.posteriorMesialDistal,
      comments: payload.gingivaLevels?.comments ?? "",
    },
    distanceToAntagonist: {
      option: payload.distanceToAntagonist?.option ?? "",
      comments: payload.distanceToAntagonist?.comments ?? "",
    },
    identificationDots: {
      option: payload.identificationDots?.option ?? "",
      comments: payload.identificationDots?.comments ?? "",
    },
    internalRetentionGroove: {
      option: payload.internalRetentionGroove?.option ?? "",
      comments: payload.internalRetentionGroove?.comments ?? "",
    },
    taperAngle: {
      option: payload.taperAngle?.option ?? "",
      comments: payload.taperAngle?.comments ?? "",
    },
    emergenceProfile: {
      option: payload.emergenceProfile?.option ?? "",
      comments: payload.emergenceProfile?.comments ?? "",
    },
    screwRetainedCrown: {
      option: payload.screwRetainedCrown?.option ?? "",
      comments: payload.screwRetainedCrown?.comments ?? "",
    },
    preferredSoftware: {
      option: payload.preferredSoftware?.option ?? "",
    },
    uploadedImage1: payload.uploadedImage1 ? {
      fileUrl: payload.uploadedImage1.fileUrl ?? "",
      fileName: payload.uploadedImage1.fileName ?? "",
    } : null,
    uploadedImage2: payload.uploadedImage2 ? {
      fileUrl: payload.uploadedImage2.fileUrl ?? "",
      fileName: payload.uploadedImage2.fileName ?? "",
    } : null,
  }
}
