/** Server hints never substitute for observed metadata on these sources. */
export const htmlFilterSupport=Object.freeze({
  LinkedIn:Object.freeze({search:'server-hint/local',location:'server-hint/local',date:'server-hint/local',company:'keyword-hint/local',employment:'server-hint/local',experience:'keyword-and-server-hint/local',remote:'server-hint/local',workplace:'server-hint/local',under:'observed-only',verified:'observed-only',sort:'server-hint/local'}),
  Indeed:Object.freeze({search:'server-hint/local',location:'server-hint/local',date:'coarse-server-hint/local',company:'server-hint/local',employment:'partial-server-hint/local',experience:'partial-server-hint/local',remote:'partial-server-hint/local',workplace:'partial-server-hint/local',under:'unsupported',verified:'unsupported',sort:'server-hint/local'}),
  Glassdoor:Object.freeze({search:'server-hint/local',location:'local/incomplete-scope',date:'local',company:'local',employment:'local',experience:'local',remote:'local',workplace:'local',under:'unsupported',verified:'unsupported',sort:'local'})
});
