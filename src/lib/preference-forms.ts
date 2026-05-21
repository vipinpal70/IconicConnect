export const anatomyOptions = ["Primary Only", "Secondary", "Match Adjacent"] as const
export const smileLibraryOptions = ["Posterior", "Anterior"] as const
export const ponticTypeOptions = ["Ovate", "Modified Ovate", "Modified Ridge Lap", "Other"] as const
export const ponticDistanceOptions = ["Flush", "Off", "Into"] as const
export const yesNoOptions = ["Yes", "No"] as const

export type AnatomyOption = (typeof anatomyOptions)[number]
export type SmileLibraryOption = (typeof smileLibraryOptions)[number]
export type PonticTypeOption = (typeof ponticTypeOptions)[number]
export type PonticDistanceOption = (typeof ponticDistanceOptions)[number]
export type YesNoOption = (typeof yesNoOptions)[number]

export type PreferenceFormPayload = {
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
})

export function clonePreferenceFormPayload(payload?: Partial<PreferenceFormPayload> | null): PreferenceFormPayload {
  const defaults = createPreferenceFormDefaults()

  if (!payload) return defaults

  return {
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
  }
}
