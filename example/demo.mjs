// COURSEWRIGHT_API_KEY=... node example/demo.mjs
import { buildCourse } from '../src/coursewright.js';
const course = await buildCourse({
  title: 'Rifle Marksmanship Fundamentals',
  diagrams: false, // set true to also draft diagrams (uses a stronger model)
  objectives: [
    { objective: 'Explain trigger control and follow-through.', title: 'Trigger Control',
      passage: 'Trigger control is the act of firing the weapon while maintaining proper aim and adequate stabilization until the bullet leaves the muzzle. Follow-through is the continued application of the fundamentals after the shot has fired.',
      cite: 'Marksmanship, Ch.8, p.8-2' },
  ],
}, (e) => console.error('  ·', e.step || e.kind, e.ok === false ? '(refused)' : ''));
console.log(JSON.stringify(course, null, 2));
