const GSM_BASIC = new Set(Array.from(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
));
const GSM_EXTENDED = new Set(Array.from("\f^{}\\[~]|€"));

export interface SmsSegmentEstimate {
  encoding: "GSM-7" | "UCS-2";
  units: number;
  segments: number;
}

export function estimateSmsSegments(message: string): SmsSegmentEstimate {
  if (message.length === 0) return { encoding: "GSM-7", units: 0, segments: 0 };

  let gsmUnits = 0;
  let gsmCompatible = true;
  for (const character of message) {
    if (GSM_BASIC.has(character)) gsmUnits += 1;
    else if (GSM_EXTENDED.has(character)) gsmUnits += 2;
    else {
      gsmCompatible = false;
      break;
    }
  }

  if (gsmCompatible) {
    return {
      encoding: "GSM-7",
      units: gsmUnits,
      segments: gsmUnits <= 160 ? 1 : Math.ceil(gsmUnits / 153),
    };
  }

  // Twilio bills UCS-2 messages by UTF-16 code unit. Astral characters such
  // as emoji therefore consume two units, which JavaScript string.length
  // reports correctly.
  const units = message.length;
  return {
    encoding: "UCS-2",
    units,
    segments: units <= 70 ? 1 : Math.ceil(units / 67),
  };
}
