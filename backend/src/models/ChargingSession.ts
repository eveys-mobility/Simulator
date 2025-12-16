export interface ChargingSession {
    transactionId?: number;
    connectorId: number;
    idTag: string;
    startTime: Date;
    startMeterValue: number;
    currentMeterValue: number;
    status: SessionStatus;
    powerKw: number;
    energyKwh: number;
    duration: number; // seconds
}

export enum SessionStatus {
    Idle = 'Idle',
    Preparing = 'Preparing',
    Charging = 'Charging',
    Paused = 'Paused',
    Finishing = 'Finishing',
    Completed = 'Completed',
    Faulted = 'Faulted'
}

export interface MeterValue {
    timestamp: Date;
    sampledValue: SampledValue[];
}

export interface SampledValue {
    value: string;
    context?: ReadingContext;
    format?: ValueFormat;
    measurand?: Measurand;
    phase?: Phase;
    location?: Location;
    unit?: UnitOfMeasure;
}

export enum ReadingContext {
    InterruptionBegin = 'Interruption.Begin',
    InterruptionEnd = 'Interruption.End',
    SampleClock = 'Sample.Clock',
    SamplePeriodic = 'Sample.Periodic',
    TransactionBegin = 'Transaction.Begin',
    TransactionEnd = 'Transaction.End',
    Trigger = 'Trigger',
    Other = 'Other'
}

export enum ValueFormat {
    Raw = 'Raw',
    SignedData = 'SignedData'
}

export enum Measurand {
    EnergyActiveImportRegister = 'Energy.Active.Import.Register',
    EnergyActiveExportRegister = 'Energy.Active.Export.Register',
    EnergyReactiveImportRegister = 'Energy.Reactive.Import.Register',
    EnergyReactiveExportRegister = 'Energy.Reactive.Export.Register',
    EnergyActiveImportInterval = 'Energy.Active.Import.Interval',
    EnergyActiveExportInterval = 'Energy.Active.Export.Interval',
    PowerActiveImport = 'Power.Active.Import',
    PowerActiveExport = 'Power.Active.Export',
    PowerReactiveImport = 'Power.Reactive.Import',
    PowerReactiveExport = 'Power.Reactive.Export',
    CurrentImport = 'Current.Import',
    CurrentExport = 'Current.Export',
    Voltage = 'Voltage',
    Temperature = 'Temperature',
    SoC = 'SoC',
    Frequency = 'Frequency'
}

export enum Phase {
    L1 = 'L1',
    L2 = 'L2',
    L3 = 'L3',
    N = 'N',
    L1N = 'L1-N',
    L2N = 'L2-N',
    L3N = 'L3-N',
    L1L2 = 'L1-L2',
    L2L3 = 'L2-L3',
    L3L1 = 'L3-L1'
}

export enum Location {
    Inlet = 'Inlet',
    Outlet = 'Outlet',
    Body = 'Body',
    Cable = 'Cable',
    EV = 'EV'
}

export enum UnitOfMeasure {
    Wh = 'Wh',
    kWh = 'kWh',
    varh = 'varh',
    kvarh = 'kvarh',
    W = 'W',
    kW = 'kW',
    VA = 'VA',
    kVA = 'kVA',
    var = 'var',
    kvar = 'kvar',
    A = 'A',
    V = 'V',
    Celsius = 'Celsius',
    Fahrenheit = 'Fahrenheit',
    K = 'K',
    Percent = 'Percent',
    Hertz = 'Hertz'
}
