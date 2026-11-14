// One palette for the whole garden — the map, the bots and the HUD all read
// from here, so the place feels like a single dusk courtyard and nothing
// clashes. Six families: the dusk sky, the mossy ground, stone, leaf, shell
// green for the Kura team, and one warm amber reserved for anything the
// player has to notice at a glance (sites, the pod, the buy menu's accent).
// The hares get their own orange so the two teams never blur in a firefight.

export const PALETTE = {
  sky: 0x1d2b33, // dusk sky, fog colour, page background
  ground: 0x3d4a3a, // mossy garden floor
  stone: 0x8a8f96, // walls, crates, planters
  stoneDark: 0x565d66, // taller perimeter walls
  leaf: 0x4f7a45, // hedges and garden beds
  shell: 0x6fae5e, // the Kura team: tortoise green
  hare: 0xd97b2f, // the Kelinci team: hare orange
  ink: 0xe9e6df, // HUD text
  muted: 0x9aa39a, // secondary HUD text
  amber: 0xf0a830, // sites, the pod, accents
  pond: 0x3f7d8c, // Site B water, fountain water
  red: 0xd95f4b, // damage and danger
};
