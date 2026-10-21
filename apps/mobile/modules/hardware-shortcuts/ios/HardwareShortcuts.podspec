Pod::Spec.new do |s|
  s.name           = 'HardwareShortcuts'
  s.version        = '0.1.0'
  s.summary        = 'Hardware keyboard shortcuts for hackOS'
  s.description    = 'Registers Command-key shortcuts (UIKeyCommand) on the root view controller for iPad keyboards and Mac (Designed for iPad).'
  s.author         = 'hackOS'
  s.homepage       = 'https://github.com/danicallero/hackOS'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
