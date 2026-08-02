Pod::Spec.new do |s|
  s.name           = 'CameraCapabilities'
  s.version        = '0.1.0'
  s.summary        = 'Camera hardware capability detection for hackOS'
  s.description    = 'Exposes whether the back camera has a hardware torch.'
  s.author         = 'hackOS'
  s.homepage       = 'https://github.com/danicallero/hackOS'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
