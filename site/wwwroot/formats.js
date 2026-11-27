import { t } from './i18n.js';

const rvt = 'RvtIO.Cli';
const nwc = 'NwcIO.Cli';
const positional = (input, output) => [input, output];
const flag = option => (input, output) => [input, option, output];
const navisFlag = option => (input, output) => [input, '-', option, output];
const option = value => (input, output) => [input, output, value];

const revit = [
  ['ifc', 'format.ifc', '.ifc', rvt, positional],
  ['ifc-parameters', 'format.ifcParameters', '.parameters.ifc', rvt, option('--ifc-revit-parameters')],
  ['compact', 'format.compact', '.compact.json', rvt, flag('--compact-json')],
  ['full', 'format.full', '.full.json', rvt, flag('--full-json')],
  ['scene', 'format.scene', '.scene.json', rvt, flag('--scene')],
  ['glb', 'format.glb', '.glb', 'RevitScene', positional],
  ['obj', 'format.obj', '.obj', 'RevitScene', positional],
  ['html', 'format.html', '.html', 'RevitScene', positional],
];
const project = [
  ['nwc', 'format.nwc', '.nwc', 'RvtIO.Nwc', option('--native')],
  ['pdf-plan', 'format.pdfPlan', '.plan.pdf', rvt, (input, output) => ['print', input, output], true],
  ['pdf', 'format.pdf', '.pdf', rvt, (input, output) => ['print', input, output, '--all-sheets'], true],
  ['pdf-views', 'format.pdfViews', '.views.pdf', rvt, (input, output) => ['print', input, output, '--all-views'], true],
  ['sheets', 'format.sheets', '.sheets.json', rvt, (input, output) => ['sheets', input, output], true],
];
const navisworks = [
  ['ifc', 'format.ifc', '.ifc', nwc, positional],
  ['ifc4', 'format.ifc4', '.ifc4.ifc', nwc, (input, output) => [input, output, '--ifc-schema', 'IFC4']],
  ['glb', 'format.glb', '.glb', nwc, positional],
  ['obj', 'format.obj', '.obj', nwc, positional],
  ['json', 'format.json', '.json', nwc, positional],
  ['scene', 'format.scene', '.scene.json', nwc, navisFlag('--scene')],
  ['html', 'format.html', '.html', 'NwcScene', positional],
  ['html-native', 'format.htmlLegacy', '.navisworks.html', nwc, navisFlag('--html-viewer'), true],
  ['nwc', 'format.nwc', '.export.nwc', nwc, positional, true],
  ['viewpoints-bcf', 'format.viewpointsBcf', '.viewpoints.bcfzip', nwc, navisFlag('--viewpoints-bcf'), true],
  ['viewpoints-xml', 'format.viewpointsXml', '.viewpoints.xml', nwc, navisFlag('--viewpoints-xml'), true],
  ['sets', 'format.sets', '.sets.xml', nwc, navisFlag('--sets-xml'), true],
  ['grids', 'format.grids', '.grids.xml', nwc, navisFlag('--export-grids'), true],
  ['schedule-csv', 'format.scheduleCsv', '.timeliner.csv', nwc, navisFlag('--timeliner-csv'), true],
  ['schedule-xml', 'format.scheduleXml', '.timeliner.xml', nwc, navisFlag('--timeliner-xml'), true],
  ['msproject', 'format.msproject', '.project.xml', nwc, navisFlag('--timeliner-msproject'), true],
  ['primavera', 'format.primavera', '.xer', nwc, navisFlag('--timeliner-primavera'), true],
  ['clash-bcf', 'format.clashBcf', '.clashes.bcfzip', nwc, navisFlag('--clash-bcf'), true],
  ['clash-xml', 'format.clashXml', '.clashes.xml', nwc, navisFlag('--clash-xml'), true],
  ['clash-html', 'format.clashHtml', '.clashes.html', nwc, navisFlag('--clash-html'), true],
];

export const extensionOf = name => name.match(/\.[^.]+$/)?.[0].toLowerCase() ?? '';

export function exportFormats(name) {
  const extension = extensionOf(name);
  const choices = extension === '.rvt' ? [...revit, ...project] : extension === '.rfa' ? revit
    : ['.nwc', '.nwd'].includes(extension) ? navisworks : [];
  return choices.map(([id, titleKey, suffix, tool, args, optional = false]) =>
    ({ id, titleKey, get title() { return t(titleKey); }, suffix, tool, args, optional }));
}

export function isRevit(name) {
  return ['.rvt', '.rfa'].includes(extensionOf(name));
}
