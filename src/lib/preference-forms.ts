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

export type AnatomyOption = (typeof anatomyOptions)[number]
export type SmileLibraryOption = (typeof smileLibraryOptions)[number]
export type PonticTypeOption = (typeof ponticTypeOptions)[number]
export type PonticDistanceOption = (typeof ponticDistanceOptions)[number]
export type YesNoOption = (typeof yesNoOptions)[number]
export type PosteriorCutbackOption = (typeof posteriorCutbackOptions)[number]
export type AnteriorCutbackOption = (typeof anteriorCutbackOptions)[number]
export type CollarTypeOption = (typeof collarTypeOptions)[number]
export type PreferredSoftwareOption = (typeof preferredSoftwareOptions)[number]

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
    defaultValues: "",
    comments: "",
  },
  proximalContacts: {
    defaultValues: "",
    comments: "",
  },
  distalMostCrownContact: {
    defaultValues: "",
    comments: "",
  },
  anatomy: {
    option: "",
    comments: "",
  },
  smileLibrary: {
    option: "",
    libraryName: "",
    comments: "",
  },
  ponticType: {
    option: "",
    comments: "",
  },
  ponticDistanceFromTissue: {
    option: "",
    comments: "",
    distanceMm: "",
  },
  matchMarginalRidge: {
    option: "",
    comments: "",
  },
  posteriorCutback: {
    option: "",
    comments: "",
  },
  anteriorCutback: {
    option: "",
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
