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
// `angles`: the oscillation range (`osal` / `osau`, `ancp` presets) of the
// Pure Cool and Hot+Cool towers. Not the desk fan (narrower range, no trace
// yet), the humidifiers (other presets: 45, 90, breeze), the Big+Quiet (it
// tilts) nor the Link models (on / off only).
//
// `picture`: the silhouette drawn in the controls widget (assets/devices):
// tower, hot-cool (the loop narrows to the base), desk, humidifier, big-quiet.
//
// Robot vacuums, lights and hair care products are listed by the account too:
// they are not fans and are left out.
// -----------------------------------------------------------------------------

const MODELS = {
  455: { name: 'Pure Hot+Cool Link', protocol: 'link', heater: true, picture: 'hot-cool' },
  469: { name: 'Pure Cool Link Desk', protocol: 'link', picture: 'desk' },
  475: { name: 'Pure Cool Link', protocol: 'link', picture: 'tower' },
  438: { name: 'Pure Cool', protocol: 'pure', airflow: true, angles: true, picture: 'tower' },
  '438E': {
    name: 'Purifier Cool',
    protocol: 'pure',
    airflow: true,
    angles: true,
    picture: 'tower',
  },
  '438K': {
    name: 'Purifier Cool Formaldehyde',
    protocol: 'pure',
    airflow: true,
    angles: true,
    picture: 'tower',
  },
  520: { name: 'Pure Cool Desk', protocol: 'pure', airflow: true, picture: 'desk' },
  527: {
    name: 'Pure Hot+Cool',
    protocol: 'pure',
    heater: true,
    airflow: true,
    angles: true,
    picture: 'hot-cool',
  },
  '527E': {
    name: 'Purifier Hot+Cool',
    protocol: 'pure',
    heater: true,
    airflow: true,
    angles: true,
    picture: 'hot-cool',
  },
  '527K': {
    name: 'Purifier Hot+Cool Formaldehyde',
    protocol: 'pure',
    heater: true,
    airflow: true,
    angles: true,
    picture: 'hot-cool',
  },
  358: { name: 'Pure Humidify+Cool', protocol: 'pure', humidifier: true, picture: 'humidifier' },
  '358E': {
    name: 'Purifier Humidify+Cool',
    protocol: 'pure',
    humidifier: true,
    picture: 'humidifier',
  },
  '358K': {
    name: 'Purifier Humidify+Cool Formaldehyde',
    protocol: 'pure',
    humidifier: true,
    picture: 'humidifier',
  },
  664: { name: 'Purifier Big+Quiet', protocol: 'pure', picture: 'big-quiet' },
};

/**
 * Describe a Dyson product type.
 * @param {string} productType `ProductType` from the Dyson account, e.g. "438K"
 * @returns {null | {productType: string, name: string, protocol: 'link'|'pure',
 *   heater: boolean, humidifier: boolean, airflow: boolean, angles: boolean,
 *   formaldehyde: boolean, picture: string}}
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
    angles: model.angles === true,
    formaldehyde: model.protocol === 'pure' && type.endsWith('K'),
    picture: model.picture,
  };
}
