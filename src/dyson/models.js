// -----------------------------------------------------------------------------
// Dyson product types -> what the device can do.
//
// The Dyson account lists every connected product with a `ProductType` code
// (`438`, `527K`...). Two generations of air treatment products speak two
// dialects of the same MQTT protocol:
//   - "link" (Pure Cool Link, Pure Hot+Cool Link): power and auto mode share
//     one key, `fmod` (FAN / AUTO / OFF);
//   - "pure" (everything since 2018): `fpwr` for power, `auto` for auto mode,
//     and the particulate / NO2 / VOC sensors.
// The letter suffix is the hardware revision: `E` for the 2021 refresh, `K` for
// the models with a formaldehyde sensor.
//
// `airflow`: the front / back airflow switch (`fdir`) of the Pure Cool and
// Hot+Cool towers and desk fans. The Link models, the humidifiers and the
// Big+Quiet blow one way only (or tilt instead).
//
// Robot vacuums, lights and hair care products are listed by the account too:
// they are not fans and are left out.
// -----------------------------------------------------------------------------

const MODELS = {
  455: { name: 'Pure Hot+Cool Link', protocol: 'link', heater: true },
  469: { name: 'Pure Cool Link Desk', protocol: 'link' },
  475: { name: 'Pure Cool Link', protocol: 'link' },
  438: { name: 'Pure Cool', protocol: 'pure', airflow: true },
  '438E': { name: 'Purifier Cool', protocol: 'pure', airflow: true },
  '438K': { name: 'Purifier Cool Formaldehyde', protocol: 'pure', airflow: true },
  520: { name: 'Pure Cool Desk', protocol: 'pure', airflow: true },
  527: { name: 'Pure Hot+Cool', protocol: 'pure', heater: true, airflow: true },
  '527E': { name: 'Purifier Hot+Cool', protocol: 'pure', heater: true, airflow: true },
  '527K': { name: 'Purifier Hot+Cool Formaldehyde', protocol: 'pure', heater: true, airflow: true },
  358: { name: 'Pure Humidify+Cool', protocol: 'pure', humidifier: true },
  '358E': { name: 'Purifier Humidify+Cool', protocol: 'pure', humidifier: true },
  '358K': { name: 'Purifier Humidify+Cool Formaldehyde', protocol: 'pure', humidifier: true },
  664: { name: 'Purifier Big+Quiet', protocol: 'pure' },
};

/**
 * Describe a Dyson product type.
 * @param {string} productType `ProductType` from the Dyson account, e.g. "438K"
 * @returns {null | {productType: string, name: string, protocol: 'link'|'pure',
 *   heater: boolean, humidifier: boolean, airflow: boolean, formaldehyde: boolean}}
 *   null when the product is not a supported fan / purifier
 */
export function describeModel(productType) {
  const type = String(productType ?? '')
    .trim()
    .toUpperCase();
  // An unknown revision of a known family (`664B`, `438M`...) behaves like the
  // family: same keys, same sensors, maybe one more.
  const model = MODELS[type] ?? MODELS[type.slice(0, 3)];
  if (!model) {
    return null;
  }
  return {
    productType: type,
    name: model.name,
    protocol: model.protocol,
    heater: model.heater === true,
    humidifier: model.humidifier === true,
    airflow: model.airflow === true,
    formaldehyde: model.protocol === 'pure' && type.endsWith('K'),
  };
}
