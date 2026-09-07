const ROUTE_STOPS = [
  {
    id: '622',
    name: 'Chestnut St & 38th St',
    lat: 39.955111,
    lng: -75.198603,
    route: '21',
    directionId: 0,
    previousStop: 'Chestnut St & 39th St',
    nextStop: 'Chestnut St & 37th St'
  },
  {
    id: '22285',
    name: '38th St & Chestnut St',
    lat: 39.955084,
    lng: -75.198261,
    route: '40',
    directionId: 1,
    previousStop: '38th St & Walnut St',
    nextStop: 'Market St & 38th St - FS'
  }
];

function readVarint(bytes, start) {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
  }
  throw new Error('Malformed protobuf varint');
}

function fields(bytes) {
  const output = [];
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset);
    offset = key.offset;
    const number = Number(key.value >> 3n);
    const wire = Number(key.value & 0x07n);
    if (wire === 0) {
      const value = readVarint(bytes, offset);
      output.push({ number, wire, value: value.value });
      offset = value.offset;
    } else if (wire === 2) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      output.push({ number, wire, value: bytes.slice(offset, end) });
      offset = end;
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type: ${wire}`);
    }
  }
  return output;
}

function firstMessage(items, fieldNumber) {
  return items.find((item) => item.number === fieldNumber && item.wire === 2)?.value;
}

function firstString(items, fieldNumber) {
  const value = firstMessage(items, fieldNumber);
  return value ? new TextDecoder().decode(value) : null;
}

function firstNumber(items, fieldNumber) {
  const item = items.find((entry) => entry.number === fieldNumber && entry.wire === 0);
  return item ? Number(item.value) : null;
}

function parseStopTimeUpdate(message) {
  const update = fields(message);
  const arrival = firstMessage(update, 2);
  const departure = firstMessage(update, 3);
  const event = arrival || departure;
  return {
    stopId: firstString(update, 4),
    time: event ? firstNumber(fields(event), 2) : null
  };
}

function parseTripUpdate(message) {
  const update = fields(message);
  const trip = firstMessage(update, 1);
  const vehicle = firstMessage(update, 3);
  const tripFields = trip ? fields(trip) : [];
  const vehicleFields = vehicle ? fields(vehicle) : [];
  return {
    routeId: firstString(tripFields, 5),
    tripId: firstString(tripFields, 1),
    vehicleId: firstString(vehicleFields, 1),
    stops: update
      .filter((item) => item.number === 2 && item.wire === 2)
      .map((item) => parseStopTimeUpdate(item.value))
  };
}

function parsePredictions(buffer) {
  const now = Math.floor(Date.now() / 1000);
  const feed = fields(new Uint8Array(buffer));
  return feed
    .filter((item) => item.number === 2 && item.wire === 2)
    .map((item) => firstMessage(fields(item.value), 3))
    .filter(Boolean)
    .map(parseTripUpdate)
    .flatMap((trip) => ROUTE_STOPS
      .filter((stop) => stop.route === trip.routeId)
      .map((stop) => ({
        ...trip,
        stop,
        arrivalEpoch: trip.stops.find((update) => update.stopId === stop.id)?.time
      })))
    .filter((trip) => trip.arrivalEpoch && trip.arrivalEpoch >= now - 30)
    .sort((a, b) => a.arrivalEpoch - b.arrivalEpoch);
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const radius = 6371000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latDelta = toRadians(lat2 - lat1);
  const lngDelta = toRadians(lng2 - lng1);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(2 * radius * Math.asin(Math.sqrt(a)));
}

async function fetchWithRetry(url, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    try {
      const separator = url.includes('?') ? '&' : '?';
      const requestUrl = `${url}${separator}_=${Date.now()}-${attempt}`;
      const result = await fetch(requestUrl, {
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Accept: '*/*',
          Connection: 'close',
          'User-Agent': 'Mozilla/5.0 SEPTA-stop-display/1.0'
        }
      });
      if (result.ok) return result;
      lastError = new Error(`SEPTA returned ${result.status} for ${url}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchBusSchedule(stopId) {
  const endpoint = 'https://www3.septa.org/api/BusSchedules/index.php';
  return Promise.any(['stop_id', 'req1'].map((parameter) =>
    fetchWithRetry(`${endpoint}?${parameter}=${stopId}`, 1).then((response) => response.json())));
}

function easternOffsetMilliseconds(epochMilliseconds) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(epochMilliseconds));
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return representedAsUtc - epochMilliseconds;
}

function parseEasternScheduleTime(value) {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})\s+(am|pm)$/i);
  if (!match) return null;
  const [, month, day, shortYear, rawHour, minute, meridiem] = match;
  let hour = Number(rawHour) % 12;
  if (meridiem.toLowerCase() === 'pm') hour += 12;
  const localAsUtc = Date.UTC(2000 + Number(shortYear), Number(month) - 1, Number(day), hour, Number(minute));
  let epoch = localAsUtc - easternOffsetMilliseconds(localAsUtc);
  epoch = localAsUtc - easternOffsetMilliseconds(epoch);
  return Math.floor(epoch / 1000);
}

function parseScheduledArrivals(payload, stop) {
  const now = Math.floor(Date.now() / 1000);
  const entries = payload?.[stop.route] || [];
  return entries
    .map((entry) => ({
      arrivalEpoch: parseEasternScheduleTime(entry.DateCalender),
      tripId: String(entry.trip_id || ''),
      vehicleId: null,
      destination: entry.DirectionDesc || `Route ${stop.route} destination`,
      direction: 'Scheduled service',
      vehicleNextStopName: null,
      distanceMeters: null,
      source: 'scheduled'
    }))
    .filter((arrival) => arrival.arrivalEpoch && arrival.arrivalEpoch >= now - 30)
    .sort((a, b) => a.arrivalEpoch - b.arrivalEpoch);
}

module.exports = async (_request, response) => {
  try {
    const [tripBuffer, vehicleData, scheduleData] = await Promise.all([
      fetchWithRetry('https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb')
        .then((result) => result.arrayBuffer())
        .catch(() => null),
      Promise.all(ROUTE_STOPS.map((stop) =>
        fetchWithRetry(`https://www3.septa.org/api/TransitView/index.php?route=${stop.route}`)
          .then((result) => result.json())
          .catch(() => null))),
      Promise.all(ROUTE_STOPS.map((stop) =>
        fetchBusSchedule(stop.id)
          .catch(() => null)))
    ]);
    if (!tripBuffer && scheduleData.every((item) => !item)) throw new Error('SEPTA did not return arrival data');

    const predictions = tripBuffer ? parsePredictions(tripBuffer) : [];
    const vehiclesByRoute = new Map(ROUTE_STOPS.map((stop, index) => [
      stop.route,
      vehicleData[index]?.bus || []
    ]));
    const routes = ROUTE_STOPS.map((stop, index) => {
      const realtimeArrivals = predictions
        .filter((prediction) => prediction.stop.id === stop.id)
        .map((prediction) => {
          const vehicles = vehiclesByRoute.get(stop.route) || [];
          const vehicle = vehicles.find((item) => String(item.VehicleID) === String(prediction.vehicleId));
          const lat = vehicle ? Number(vehicle.lat) : null;
          const lng = vehicle ? Number(vehicle.lng) : null;
          return {
            arrivalEpoch: prediction.arrivalEpoch,
            vehicleId: prediction.vehicleId,
            destination: vehicle?.destination || `Route ${stop.route} destination`,
            direction: vehicle?.Direction || null,
            vehicleNextStopName: vehicle?.next_stop_name || null,
            distanceMeters: Number.isFinite(lat) && Number.isFinite(lng)
              ? distanceMeters(lat, lng, stop.lat, stop.lng)
              : null,
            source: 'realtime'
          };
        });
      const scheduledArrivals = parseScheduledArrivals(scheduleData[index], stop);
      const arrivals = [...realtimeArrivals];
      const matchedScheduleIndexes = new Set();
      realtimeArrivals.forEach((realtime) => {
        let closestIndex = -1;
        let closestDifference = Infinity;
        scheduledArrivals.forEach((scheduled, scheduledIndex) => {
          if (matchedScheduleIndexes.has(scheduledIndex)) return;
          const difference = Math.abs(realtime.arrivalEpoch - scheduled.arrivalEpoch);
          if (difference < closestDifference) {
            closestDifference = difference;
            closestIndex = scheduledIndex;
          }
        });
        if (closestIndex >= 0 && closestDifference < 480) matchedScheduleIndexes.add(closestIndex);
      });
      scheduledArrivals.forEach((scheduled, scheduledIndex) => {
        if (!matchedScheduleIndexes.has(scheduledIndex)) arrivals.push(scheduled);
      });
      arrivals.sort((a, b) => a.arrivalEpoch - b.arrivalEpoch);
      return {
        ...stop,
        realtimeFeedAvailable: Boolean(tripBuffer),
        scheduleAvailable: Boolean(scheduleData[index]),
        arrivalDataAvailable: Boolean(scheduleData[index]) || realtimeArrivals.length > 0,
        arrivals: arrivals.slice(0, 2)
      };
    });

    response.setHeader('Cache-Control', 'no-store, max-age=0');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.status(200).json({
      stopName: '38th St & Chestnut St',
      updatedAt: new Date().toISOString(),
      routes
    });
  } catch (error) {
    response.status(502).json({
      error: 'Live SEPTA data is temporarily unavailable.',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
