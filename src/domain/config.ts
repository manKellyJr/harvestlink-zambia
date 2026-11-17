/** Pilot settings. Changing crop or province is configuration, not code. */
export const pilot = {
  crop: process.env.PILOT_CROP ?? "soybeans",
  province: process.env.PILOT_PROVINCE ?? "Central",
};

/** Business limits that protect against data-entry mistakes. */
export const limits = {
  minLotKg: 50, // one 50 kg bag
  maxLotKg: 20_000,
  maxOrderKg: 60_000, // two 30 t trucks
  maxPricePerKgNgwee: 10_000, // K100/kg, far above any realistic soybean price
};
