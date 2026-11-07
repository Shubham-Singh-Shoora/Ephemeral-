import type { SyntheticColumnProfile } from '@ephemeral/eth-swarm';
import type { Dataset } from './data';

export const modelProfiles = [
  'linear_or_distance',
  'tree_ensemble',
  'deep_vision_monai',
  'custom_sklearn_pipeline',
] as const;

export const targetMetrics = ['f1_macro', 'roc_auc', 'accuracy', 'rmse'] as const;
export type ModelProfile = typeof modelProfiles[number];
export type TargetMetric = typeof targetMetrics[number];
export type TaskType = 'classification' | 'regression';

export type TrainingConfiguration = {
  targetColumns: string[];
  featureColumns: string[];
  taskTypes: Record<string, TaskType>;
  modelProfile: ModelProfile;
  targetMetric: TargetMetric;
  minTargetScore: number;
  maxOverfitGap: number;
  maxTuningTrials: number;
  splitSeed: number;
};

export type PreflightResult = {
  valid: boolean;
  sampleRows: number;
  rawFeatureCount: number;
  encodedFeatureCount: number;
  targetCount: number;
  targetDimensions: Record<string, number>;
  transformations: string[];
  errors: string[];
  warnings: string[];
};

const identifierPattern = /(^|\b)(sl\s*no|serial|patient|subject|record|mrn|name|email|phone|address|district|city|zip|pin|aadhaar|abha|ssn|religion)(\b|$)/i;
const targetPattern = /(diagnos|outcome|target|label|class|mortality|survival|response|readmission|risk)/i;

export function inferColumnProfile(dataset: Dataset, column: string): SyntheticColumnProfile {
  const known = dataset.columnProfiles?.find(profile => profile.name === column);
  if (known) return known;
  const index = dataset.columns.indexOf(column);
  const values = (dataset.rows || []).map(row => row[index]).filter(Boolean);
  const numeric = values.length > 0 && values.every(value => value === '90+' || Number.isFinite(Number(value)));
  if (identifierPattern.test(column)) {
    return {
      name: column,
      privacyTier: 'safe_harbor_identifier',
      dataType: 'redacted',
      role: 'identifier',
      includedInFeaturesByDefault: false,
      transformation: 'Excluded by the privacy policy.',
    };
  }
  if (targetPattern.test(column)) {
    return {
      name: column,
      privacyTier: 'clinical_target',
      dataType: numeric ? 'float' : 'categorical',
      role: 'target',
      includedInFeaturesByDefault: false,
      domain: numeric ? undefined : [...new Set(values)],
      transformation: 'Inferred target candidate from the synthetic schema.',
    };
  }
  return {
    name: column,
    privacyTier: numeric ? 'continuous_measurement' : 'bounded_categorical',
    dataType: numeric ? 'float' : 'categorical',
    role: 'feature',
    includedInFeaturesByDefault: true,
    domain: numeric ? undefined : [...new Set(values)],
    transformation: numeric ? 'Numeric feature.' : 'Categorical feature.',
  };
}

export function defaultTrainingSelection(dataset: Dataset) {
  const profiles = dataset.columns.map(column => inferColumnProfile(dataset, column));
  const candidate = profiles.find(profile => profile.role === 'target')
    ?? [...profiles].reverse().find(profile => profile.role !== 'identifier');
  const targetColumns = candidate ? [candidate.name] : [];
  const featureColumns = profiles
    .filter(profile => profile.includedInFeaturesByDefault && !targetColumns.includes(profile.name))
    .map(profile => profile.name);
  const taskTypes = Object.fromEntries(targetColumns.map(column => [
    column,
    inferColumnProfile(dataset, column).dataType === 'categorical' || inferColumnProfile(dataset, column).dataType === 'boolean'
      ? 'classification'
      : 'regression',
  ])) as Record<string, TaskType>;
  return { targetColumns, featureColumns, taskTypes };
}

function domainSize(dataset: Dataset, column: string, profile: SyntheticColumnProfile) {
  if (profile.domain?.length) return profile.domain.length;
  const index = dataset.columns.indexOf(column);
  return new Set((dataset.rows || []).map(row => row[index]).filter(Boolean)).size;
}

export function validatePreflight(dataset: Dataset, config: TrainingConfiguration): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const transformations = new Set<string>();
  const overlap = config.targetColumns.filter(column => config.featureColumns.includes(column));
  if (!config.targetColumns.length) errors.push('Select at least one target column.');
  if (!config.featureColumns.length) errors.push('Select at least one input feature.');
  if (overlap.length) errors.push(`Targets cannot also be input features: ${overlap.join(', ')}.`);
  if (config.targetColumns.some(column => !dataset.columns.includes(column))) errors.push('A selected target is missing from the schema.');
  if (config.featureColumns.some(column => !dataset.columns.includes(column))) errors.push('A selected feature is missing from the schema.');
  if (config.minTargetScore <= 0 || config.minTargetScore > 1) errors.push('Minimum target score must be greater than 0 and at most 1.');
  if (config.maxOverfitGap < 0 || config.maxOverfitGap > 0.5) errors.push('Maximum overfit gap must be between 0 and 0.5.');
  if (!Number.isInteger(config.maxTuningTrials) || config.maxTuningTrials < 1 || config.maxTuningTrials > 25) errors.push('Tuning trials must be an integer from 1 to 25.');

  if (config.modelProfile === 'deep_vision_monai' && !/dicom|nifti/i.test(dataset.format || '')) {
    errors.push('MONAI requires a DICOM or NIfTI dataset; this catalog entry is tabular.');
  }

  let encodedFeatureCount = 0;
  for (const column of config.featureColumns) {
    const profile = inferColumnProfile(dataset, column);
    if (profile.role === 'identifier' || profile.dataType === 'redacted') {
      errors.push(`${column} is privacy-excluded and cannot be used as an input feature.`);
      continue;
    }
    if (config.modelProfile === 'linear_or_distance' && ['categorical', 'boolean'].includes(profile.dataType)) {
      const width = Math.max(1, domainSize(dataset, column, profile) - 1);
      encodedFeatureCount += width;
      transformations.add(`One-hot encode ${column} (${width} columns, first level dropped)`);
    } else {
      encodedFeatureCount += 1;
      if (config.modelProfile === 'tree_ensemble' && ['categorical', 'boolean'].includes(profile.dataType)) {
        transformations.add(`Ordinal encode ${column} (unknown = -1)`);
      }
    }
    if (config.modelProfile === 'linear_or_distance' && ['integer', 'float', 'age'].includes(profile.dataType)) {
      transformations.add(`Median-impute and standardize ${column}`);
    }
    if (config.modelProfile === 'tree_ensemble' && ['integer', 'float', 'age'].includes(profile.dataType)) {
      transformations.add(`Median-impute ${column}; no scaling`);
    }
  }

  const targetDimensions: Record<string, number> = {};
  const taskTypes = config.targetColumns.map(column => config.taskTypes[column]);
  for (const column of config.targetColumns) {
    const profile = inferColumnProfile(dataset, column);
    if (profile.role === 'identifier' || profile.dataType === 'redacted') errors.push(`${column} cannot be selected as a target.`);
    const task = config.taskTypes[column];
    if (!task) {
      errors.push(`Choose classification or regression for ${column}.`);
      continue;
    }
    const classes = domainSize(dataset, column, profile);
    targetDimensions[column] = task === 'classification' ? classes : 1;
    if (task === 'classification' && classes < 2) errors.push(`${column} needs at least two disclosed synthetic classes for a classification dry run.`);
    if (task === 'regression' && ['categorical', 'boolean'].includes(profile.dataType)) warnings.push(`${column} is categorical in the schema but configured for regression.`);
  }

  if (config.targetMetric === 'rmse' && taskTypes.some(task => task === 'classification')) {
    errors.push('RMSE can only be used when every target is regression.');
  }
  if (config.targetMetric !== 'rmse' && taskTypes.some(task => task === 'regression')) {
    errors.push(`${config.targetMetric} can only be used when every target is classification.`);
  }
  if (config.targetMetric === 'roc_auc' && config.targetColumns.some(column => targetDimensions[column] < 2)) {
    errors.push('ROC AUC requires at least two classes for every target.');
  }
  if (config.modelProfile === 'custom_sklearn_pipeline') {
    errors.push('Custom pipelines require an allowlisted attested runner and cannot be funded through the tabular runner yet.');
  }

  const sampleRows = dataset.rows?.length || 0;
  if (!sampleRows) errors.push('The dataset does not expose a synthetic mirror for the dry run.');
  return {
    valid: errors.length === 0,
    sampleRows,
    rawFeatureCount: config.featureColumns.length,
    encodedFeatureCount,
    targetCount: config.targetColumns.length,
    targetDimensions,
    transformations: [...transformations],
    errors,
    warnings,
  };
}
