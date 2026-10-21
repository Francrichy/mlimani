/**
 * GPS / telematics integration layer
 * Supports: generic webhook push, Traccar, common TZ trackers (KeepTrack-style)
 * Devices linked to vehicles; positions stored for Live Tracking
 */
const { read, write, uid, now } = require('./db');

function companyFilter(list, auth) {
  if (!list) return [];
  if (auth.role === 'platform_admin') return list;
  return list.filter(x => x.company_id === auth.company_id);
}

function listDevices(auth) {
  return companyFilter(read('gps_devices') || [], auth);
}

function registerDevice(auth, body) {
  if (!auth.company_id) throw new Error('No company');
  const device = {
    id: uid(),
    company_id: auth.company_id,
    vehicle_id: body.vehicle_id || null,
    imei: body.imei || body.device_id || '',
    provider: body.provider || 'generic', // generic | traccar | keeptrack | custom
    label: body.label || '',
    status: 'active',
    last_lat: null,
    last_lng: null,
    last_speed: null,
    last_seen: null,
    created_at: now()
  };
  const all = read('gps_devices') || [];
  all.push(device);
  write('gps_devices', all);
  return device;
}

function updateDevice(auth, id, body) {
  const all = read('gps_devices') || [];
  const idx = all.findIndex(d => d.id === id && (auth.role === 'platform_admin' || d.company_id === auth.company_id));
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...body, id: all[idx].id, company_id: all[idx].company_id };
  write('gps_devices', all);
  return all[idx];
}

/** Webhook / API push from GPS provider */
function ingestPosition({ imei, device_id, lat, lng, speed, heading, company_id, raw }) {
  const devices = read('gps_devices') || [];
  let device = devices.find(d =>
    (imei && d.imei === String(imei)) ||
    (device_id && d.id === device_id)
  );
  if (!device && company_id) {
    // auto-register unknown device for company
    device = {
      id: uid(), company_id, vehicle_id: null, imei: String(imei || ''), provider: 'generic',
      label: 'Auto', status: 'active', created_at: now()
    };
    devices.push(device);
  }
  if (!device) return { ok: false, error: 'Unknown device' };

  device.last_lat = Number(lat);
  device.last_lng = Number(lng);
  device.last_speed = speed != null ? Number(speed) : device.last_speed;
  device.last_heading = heading != null ? Number(heading) : device.last_heading;
  device.last_seen = now();
  write('gps_devices', devices);

  const positions = read('gps_positions') || [];
  positions.push({
    id: uid(),
    device_id: device.id,
    company_id: device.company_id,
    vehicle_id: device.vehicle_id,
    lat: device.last_lat,
    lng: device.last_lng,
    speed: device.last_speed,
    heading: device.last_heading,
    recorded_at: now(),
    raw: raw || null
  });
  // keep last 5000 points
  write('gps_positions', positions.slice(-5000));
  return { ok: true, device_id: device.id };
}

function livePositions(auth) {
  const devices = listDevices(auth);
  const vehicles = companyFilter(read('vehicles') || [], auth);
  const vMap = Object.fromEntries(vehicles.map(v => [v.id, v]));

  return devices.map(d => {
    const v = d.vehicle_id ? vMap[d.vehicle_id] : null;
    const ageMin = d.last_seen ? Math.round((Date.now() - new Date(d.last_seen).getTime()) / 60000) : null;
    return {
      device_id: d.id,
      imei: d.imei,
      provider: d.provider,
      vehicle_id: d.vehicle_id,
      plate: v?.plate || d.label || d.imei,
      lat: d.last_lat,
      lng: d.last_lng,
      speed: d.last_speed,
      heading: d.last_heading,
      last_seen: d.last_seen,
      online: ageMin != null && ageMin < 15,
      status: d.last_speed > 5 ? 'moving' : (d.last_lat ? 'parked' : 'no_fix')
    };
  });
}

function seedGps(companyId) {
  if ((read('gps_devices') || []).length) return;
  const vehicles = (read('vehicles') || []).filter(v => v.company_id === companyId);
  const devices = vehicles.map((v, i) => ({
    id: uid(),
    company_id: companyId,
    vehicle_id: v.id,
    imei: `8600000${100000 + i}`,
    provider: i === 0 ? 'traccar' : 'generic',
    label: v.plate,
    status: 'active',
    last_lat: -6.7924 + i * 0.02,
    last_lng: 39.2083 + i * 0.03,
    last_speed: i === 2 ? 0 : 40 + i * 10,
    last_heading: 90,
    last_seen: now(),
    created_at: now()
  }));
  write('gps_devices', devices);
  write('gps_positions', []);
}

module.exports = {
  listDevices, registerDevice, updateDevice, ingestPosition, livePositions, seedGps
};
