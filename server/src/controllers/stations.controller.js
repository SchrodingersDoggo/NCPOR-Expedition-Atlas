import stations from '../../data/researchStations.data.js';
export const getStations = (req, res) => res.json({ success: true, data: stations });
