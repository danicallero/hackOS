Pod::Spec.new do |s|
  s.name           = 'FoldRegion'
  s.version        = '0.1.0'
  s.summary        = 'iPhone Duo division reserved region for hackOS'
  s.description    = 'Exposes the foldable iPhone fold (UIView reserved region of kind division) to JavaScript.'
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
