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

module.exports = async (_request, response) => {
  try {
    const [tripResponse, ...vehicleResponses] = await Promise.all([
      fetch('https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb'),
      ...ROUTE_STOPS.map((stop) => fetch(`https://www3.septa.org/api/TransitView/index.php?route=${stop.route}`))
    ]);
    if (!tripResponse.ok || vehicleResponses.some((item) => !item.ok)) {
      throw new Error('SEPTA did not return live data');
    }

    const predictions = parsePredictions(await tripResponse.arrayBuffer());
    const vehicleData = await Promise.all(vehicleResponses.map((item) => item.json()));
    const vehiclesByRoute = new Map(ROUTE_STOPS.map((stop, index) => [
      stop.route,
      vehicleData[index].bus || []
    ]));
    const routes = ROUTE_STOPS.map((stop) => {
      const arrivals = predictions
        .filter((prediction) => prediction.stop.id === stop.id)
        .slice(0, 2)
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
              : null
          };
        });
      return { ...stop, arrivals };
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
